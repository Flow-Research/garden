import type { GardenDatabase } from '@garden/db'
import {
  LocalPart,
  type MailDomain,
  type MailDomainStatus,
  ProviderKey,
  UtcTimestamp,
} from '@garden/core/mail'
import { Clock, Effect, Layer, Schema } from 'effect'
import {
  type EmailRoutingState,
  MailDomainProvider,
  type ProvisionedSendingSubdomain,
} from './domain-provider.ts'
import {
  type MailDomainProvisioningEvidence,
  MailDomainProvisioningEvidence as MailDomainProvisioningEvidenceSchema,
  MailProvisioning,
  MailProvisioningStateError,
  type RegisterProvisionedDomainInput,
  providerEvidence,
  sendingEvidence,
} from './provisioning-contracts.ts'
import {
  getProvisionedDomain,
  listProvisionedDomains,
  persistAddress,
  persistMailbox,
  persistMailboxAccess,
  removePersistedMailboxAccess,
  reserveProvisionedDomain,
  updateProvisionedDomain,
} from './provisioning-persistence.ts'

export * from './provisioning-contracts.ts'

const CLOUDFLARE_PROVIDER = ProviderKey.make('cloudflare-email-service')

/** Uses Effect's active clock so verification observations are testable. */
const checkedAt = Effect.fn('MailProvisioning.checkedAt')(function* () {
  return UtcTimestamp.make(
    new Date(yield* Clock.currentTimeMillis).toISOString(),
  )
})

/** Initial durable checkpoint exists before any external provider mutation. */
const initialEvidence = (
  input: RegisterProvisionedDomainInput,
): MailDomainProvisioningEvidence => ({
  zoneId: input.zoneId,
  workerName: input.workerName,
  sending: null,
  routing: null,
  catchAll: null,
})

/** Decodes the one strict evidence shape allowed by provisioning workflows. */
const decodeEvidence = (
  domain: MailDomain,
  operation: string,
): Effect.Effect<MailDomainProvisioningEvidence, MailProvisioningStateError> =>
  domain.providerEvidence === null
    ? Effect.fail(
        new MailProvisioningStateError({
          workspaceId: domain.workspaceId,
          domainId: domain.id,
          operation,
          message: 'Mail domain has no provider provisioning evidence.',
        }),
      )
    : Schema.decodeUnknownEffect(MailDomainProvisioningEvidenceSchema)(
        domain.providerEvidence,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new MailProvisioningStateError({
              workspaceId: domain.workspaceId,
              domainId: domain.id,
              operation,
              message: 'Mail domain provider evidence is invalid.',
              cause,
            }),
        ),
      )

/** Prevents a repeated registration from silently switching provider zones. */
const evidenceForRegistration = (
  domain: MailDomain,
  input: RegisterProvisionedDomainInput,
): Effect.Effect<MailDomainProvisioningEvidence, MailProvisioningStateError> =>
  domain.providerEvidence === null
    ? Effect.succeed(initialEvidence(input))
    : decodeEvidence(domain, 'registerDomain.decodeEvidence').pipe(
        Effect.flatMap((evidence) =>
          evidence.zoneId === input.zoneId &&
          evidence.workerName === input.workerName
            ? Effect.succeed(evidence)
            : Effect.fail(
                new MailProvisioningStateError({
                  workspaceId: input.workspaceId,
                  domainId: domain.id,
                  operation: 'registerDomain',
                  message:
                    'Existing domain registration uses different provider authority.',
                }),
              ),
        ),
      )

/** Maps provider health into Garden's canonical lifecycle state. */
const domainStatus = (
  sending: ProvisionedSendingSubdomain,
  routing: EmailRoutingState,
): MailDomainStatus => {
  if (!sending.enabled || !routing.enabled) return 'suspended'
  if (routing.status === 'ready') return 'active'
  if (
    routing.status === 'misconfigured' ||
    routing.status === 'misconfigured_locked'
  ) {
    return 'failed'
  }
  return 'pending_verification'
}

/** Provider responses must describe the domain Garden asked to provision. */
const requireMatchingProviderDomain = (
  domain: MailDomain,
  sending: ProvisionedSendingSubdomain,
  routing: EmailRoutingState,
  operation: string,
): Effect.Effect<void, MailProvisioningStateError> =>
  sending.name === domain.name && routing.domain === domain.name
    ? Effect.void
    : Effect.fail(
        new MailProvisioningStateError({
          workspaceId: domain.workspaceId,
          domainId: domain.id,
          operation,
          message: 'Provider response described a different mail domain.',
        }),
      )

/** Normalizes the latest routing observation for the evidence ledger. */
const routingEvidence = (
  routing: EmailRoutingState,
  observedAt: UtcTimestamp,
): MailDomainProvisioningEvidence['routing'] => ({
  enabled: routing.enabled,
  status: routing.status,
  supportsSubaddressing: routing.supportsSubaddressing,
  checkedAt: observedAt,
})

/**
 * Application service layer. Provider calls remain outside Postgres
 * transactions; local checkpoints make the idempotent onboarding retryable.
 */
export const makeMailProvisioningLayer = (
  db: GardenDatabase,
): Layer.Layer<MailProvisioning, never, MailDomainProvider> =>
  Layer.effect(
    MailProvisioning,
    Effect.gen(function* () {
      const domainProvider = yield* MailDomainProvider

      return MailProvisioning.of({
        listDomains: Effect.fn('MailProvisioning.listDomains')(
          function* (input) {
            return yield* listProvisionedDomains(db, input.workspaceId)
          },
        ),
        registerDomain: Effect.fn('MailProvisioning.registerDomain')(
          function* (input) {
            const reserved = yield* reserveProvisionedDomain(db, {
              workspaceId: input.workspaceId,
              name: input.name,
              transportProvider: CLOUDFLARE_PROVIDER,
              providerEvidence: providerEvidence(initialEvidence(input)),
            })
            const baseEvidence = yield* evidenceForRegistration(reserved, input)

            const sending =
              reserved.providerDomainId === null
                ? yield* domainProvider.registerSendingSubdomain({
                    zoneId: input.zoneId,
                    name: input.name,
                  })
                : yield* domainProvider.inspectSendingSubdomain({
                    zoneId: input.zoneId,
                    providerDomainId: reserved.providerDomainId,
                  })
            if (sending.name !== reserved.name) {
              return yield* new MailProvisioningStateError({
                workspaceId: input.workspaceId,
                domainId: reserved.id,
                operation: 'registerDomain.registerSendingSubdomain',
                message: 'Provider registered a different sending domain.',
              })
            }
            const sendingCheckedAt = yield* checkedAt()
            const withSending: MailDomainProvisioningEvidence = {
              ...baseEvidence,
              sending: sendingEvidence(sending, sendingCheckedAt),
            }
            yield* updateProvisionedDomain(db, {
              workspaceId: input.workspaceId,
              domainId: reserved.id,
              status: 'pending_verification',
              transportProvider: sending.provider,
              providerDomainId: sending.providerDomainId,
              providerEvidence: providerEvidence(withSending),
              verifiedAt: reserved.verifiedAt,
            })

            const routing =
              baseEvidence.routing === null
                ? yield* domainProvider.enableEmailRouting({
                    zoneId: input.zoneId,
                    domain: input.name,
                  })
                : yield* domainProvider.inspectEmailRouting({
                    zoneId: input.zoneId,
                  })
            yield* requireMatchingProviderDomain(
              reserved,
              sending,
              routing,
              'registerDomain.enableEmailRouting',
            )
            const routingCheckedAt = yield* checkedAt()
            const withRouting: MailDomainProvisioningEvidence = {
              ...withSending,
              routing: routingEvidence(routing, routingCheckedAt),
            }
            yield* updateProvisionedDomain(db, {
              workspaceId: input.workspaceId,
              domainId: reserved.id,
              status: 'pending_verification',
              transportProvider: sending.provider,
              providerDomainId: sending.providerDomainId,
              providerEvidence: providerEvidence(withRouting),
              verifiedAt: reserved.verifiedAt,
            })

            const catchAll = yield* domainProvider.setCatchAllWorkerDelivery({
              zoneId: input.zoneId,
              workerName: input.workerName,
            })
            const catchAllCheckedAt = yield* checkedAt()
            const evidence: MailDomainProvisioningEvidence = {
              ...withRouting,
              catchAll: {
                enabled: catchAll.enabled,
                providerRuleId: catchAll.providerRuleId,
                configuredAt: catchAllCheckedAt,
              },
            }
            const status = domainStatus(sending, routing)
            return yield* updateProvisionedDomain(db, {
              workspaceId: input.workspaceId,
              domainId: reserved.id,
              status,
              transportProvider: sending.provider,
              providerDomainId: sending.providerDomainId,
              providerEvidence: providerEvidence(evidence),
              verifiedAt:
                status === 'active' ? catchAllCheckedAt : reserved.verifiedAt,
            })
          },
        ),
        refreshDomain: Effect.fn('MailProvisioning.refreshDomain')(
          function* (input) {
            const domain = yield* getProvisionedDomain(db, input)
            const evidence = yield* decodeEvidence(
              domain,
              'refreshDomain.decodeEvidence',
            )
            if (domain.providerDomainId === null) {
              return yield* new MailProvisioningStateError({
                workspaceId: input.workspaceId,
                domainId: input.domainId,
                operation: 'refreshDomain',
                message: 'Mail domain has no provider sending-domain ID.',
              })
            }

            const sending = yield* domainProvider.inspectSendingSubdomain({
              zoneId: evidence.zoneId,
              providerDomainId: domain.providerDomainId,
            })
            const routing = yield* domainProvider.inspectEmailRouting({
              zoneId: evidence.zoneId,
            })
            yield* requireMatchingProviderDomain(
              domain,
              sending,
              routing,
              'refreshDomain.inspect',
            )
            const observedAt = yield* checkedAt()
            const refreshedEvidence: MailDomainProvisioningEvidence = {
              ...evidence,
              sending: sendingEvidence(sending, observedAt),
              routing: routingEvidence(routing, observedAt),
            }
            const status = domainStatus(sending, routing)
            return yield* updateProvisionedDomain(db, {
              workspaceId: input.workspaceId,
              domainId: domain.id,
              status,
              transportProvider: sending.provider,
              providerDomainId: sending.providerDomainId,
              providerEvidence: providerEvidence(refreshedEvidence),
              verifiedAt: status === 'active' ? observedAt : domain.verifiedAt,
            })
          },
        ),
        createMailbox: Effect.fn('MailProvisioning.createMailbox')(
          function* (input) {
            return yield* persistMailbox(db, input)
          },
        ),
        createAddress: Effect.fn('MailProvisioning.createAddress')(
          function* (input) {
            return input._tag === 'Alias'
              ? yield* persistAddress(db, {
                  workspaceId: input.workspaceId,
                  domainId: input.domainId,
                  mailboxId: input.mailboxId,
                  localPart: input.localPart,
                  kind: 'alias',
                })
              : yield* persistAddress(db, {
                  workspaceId: input.workspaceId,
                  domainId: input.domainId,
                  mailboxId: input.mailboxId,
                  localPart: LocalPart.make('*'),
                  kind: 'catch_all',
                })
          },
        ),
        setMailboxAccess: Effect.fn('MailProvisioning.setMailboxAccess')(
          function* (input) {
            return yield* persistMailboxAccess(db, input)
          },
        ),
        removeMailboxAccess: Effect.fn('MailProvisioning.removeMailboxAccess')(
          function* (input) {
            yield* removePersistedMailboxAccess(db, input)
          },
        ),
      })
    }),
  )
