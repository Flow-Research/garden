import {
  DomainName,
  ProviderKey,
  ProviderObjectId,
  UtcTimestamp,
} from '@garden/core/mail'
import { Context, Effect, Layer, Ref, Schema } from 'effect'

const NonEmptyString = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)))

/** Opaque zone identifier understood only by the selected domain provider. */
export const MailDomainZoneId = NonEmptyString.pipe(
  Schema.brand('MailDomainZoneId'),
)
export type MailDomainZoneId = typeof MailDomainZoneId.Type

/** Provider deployment target that will receive unmatched inbound messages. */
export const MailWorkerName = NonEmptyString.pipe(
  Schema.brand('MailWorkerName'),
)
export type MailWorkerName = typeof MailWorkerName.Type

export const SendingSubdomainRegistration = Schema.Struct({
  zoneId: MailDomainZoneId,
  name: DomainName,
})
export interface SendingSubdomainRegistration extends Schema.Schema.Type<
  typeof SendingSubdomainRegistration
> {}

export const SendingSubdomainReference = Schema.Struct({
  zoneId: MailDomainZoneId,
  providerDomainId: ProviderObjectId,
})
export interface SendingSubdomainReference extends Schema.Schema.Type<
  typeof SendingSubdomainReference
> {}

/** Garden's normalized view of a provider-owned outbound sending domain. */
export const ProvisionedSendingSubdomain = Schema.Struct({
  provider: ProviderKey,
  zoneId: MailDomainZoneId,
  providerDomainId: ProviderObjectId,
  name: DomainName,
  enabled: Schema.Boolean,
  createdAt: Schema.NullOr(UtcTimestamp),
  modifiedAt: Schema.NullOr(UtcTimestamp),
  dkimSelector: Schema.NullOr(NonEmptyString),
  previewEnabled: Schema.NullOr(Schema.Boolean),
  returnPathDomain: Schema.NullOr(DomainName),
})
export interface ProvisionedSendingSubdomain extends Schema.Schema.Type<
  typeof ProvisionedSendingSubdomain
> {}

export const EnableEmailRoutingInput = Schema.Struct({
  zoneId: MailDomainZoneId,
  domain: DomainName,
})
export interface EnableEmailRoutingInput extends Schema.Schema.Type<
  typeof EnableEmailRoutingInput
> {}

export const InspectEmailRoutingInput = Schema.Struct({
  zoneId: MailDomainZoneId,
})
export interface InspectEmailRoutingInput extends Schema.Schema.Type<
  typeof InspectEmailRoutingInput
> {}

export const EmailRoutingStatus = Schema.Literals([
  'ready',
  'unconfigured',
  'misconfigured',
  'misconfigured_locked',
  'unlocked',
])
export type EmailRoutingStatus = typeof EmailRoutingStatus.Type

/** Provider-neutral state needed by onboarding and health checks. */
export const EmailRoutingState = Schema.Struct({
  provider: ProviderKey,
  zoneId: MailDomainZoneId,
  providerRoutingId: ProviderObjectId,
  domain: DomainName,
  enabled: Schema.Boolean,
  status: Schema.NullOr(EmailRoutingStatus),
  createdAt: Schema.NullOr(UtcTimestamp),
  modifiedAt: Schema.NullOr(UtcTimestamp),
  wizardSkipped: Schema.NullOr(Schema.Boolean),
  supportsSubaddressing: Schema.NullOr(Schema.Boolean),
})
export interface EmailRoutingState extends Schema.Schema.Type<
  typeof EmailRoutingState
> {}

export const SetCatchAllWorkerDeliveryInput = Schema.Struct({
  zoneId: MailDomainZoneId,
  workerName: MailWorkerName,
})
export interface SetCatchAllWorkerDeliveryInput extends Schema.Schema.Type<
  typeof SetCatchAllWorkerDeliveryInput
> {}

/** Confirmed catch-all delivery state after the provider accepts an update. */
export const CatchAllWorkerDelivery = Schema.Struct({
  provider: ProviderKey,
  zoneId: MailDomainZoneId,
  providerRuleId: Schema.NullOr(ProviderObjectId),
  workerName: MailWorkerName,
  enabled: Schema.Boolean,
})
export interface CatchAllWorkerDelivery extends Schema.Schema.Type<
  typeof CatchAllWorkerDelivery
> {}

export const DomainProviderIssue = Schema.Struct({
  code: NonEmptyString,
  message: Schema.String,
})
export interface DomainProviderIssue extends Schema.Schema.Type<
  typeof DomainProviderIssue
> {}

/** Provider or network request could not be completed. */
export class MailDomainProviderRequestError extends Schema.TaggedErrorClass<MailDomainProviderRequestError>()(
  'MailDomainProviderRequestError',
  {
    provider: ProviderKey,
    operation: NonEmptyString,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Provider rejected a syntactically valid provisioning operation. */
export class MailDomainProviderRejectedError extends Schema.TaggedErrorClass<MailDomainProviderRejectedError>()(
  'MailDomainProviderRejectedError',
  {
    provider: ProviderKey,
    operation: NonEmptyString,
    statusCode: Schema.Int,
    issues: Schema.Array(DomainProviderIssue),
    message: Schema.String,
  },
) {}

/** Provider resource referenced by Garden no longer exists. */
export class MailDomainProviderNotFoundError extends Schema.TaggedErrorClass<MailDomainProviderNotFoundError>()(
  'MailDomainProviderNotFoundError',
  {
    provider: ProviderKey,
    operation: NonEmptyString,
    resource: Schema.Literals(['sending_subdomain', 'email_routing']),
    resourceId: NonEmptyString,
    message: Schema.String,
  },
) {}

/** Provider response did not satisfy its documented or semantic contract. */
export class MailDomainProviderResponseError extends Schema.TaggedErrorClass<MailDomainProviderResponseError>()(
  'MailDomainProviderResponseError',
  {
    provider: ProviderKey,
    operation: NonEmptyString,
    statusCode: Schema.Int,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type MailDomainProviderError =
  | MailDomainProviderRequestError
  | MailDomainProviderRejectedError
  | MailDomainProviderNotFoundError
  | MailDomainProviderResponseError

export interface MailDomainProviderService {
  readonly registerSendingSubdomain: (
    input: SendingSubdomainRegistration,
  ) => Effect.Effect<ProvisionedSendingSubdomain, MailDomainProviderError>
  readonly inspectSendingSubdomain: (
    input: SendingSubdomainReference,
  ) => Effect.Effect<ProvisionedSendingSubdomain, MailDomainProviderError>
  readonly deleteSendingSubdomain: (
    input: SendingSubdomainReference,
  ) => Effect.Effect<void, MailDomainProviderError>
  readonly enableEmailRouting: (
    input: EnableEmailRoutingInput,
  ) => Effect.Effect<EmailRoutingState, MailDomainProviderError>
  readonly inspectEmailRouting: (
    input: InspectEmailRoutingInput,
  ) => Effect.Effect<EmailRoutingState, MailDomainProviderError>
  readonly setCatchAllWorkerDelivery: (
    input: SetCatchAllWorkerDeliveryInput,
  ) => Effect.Effect<CatchAllWorkerDelivery, MailDomainProviderError>
}

/** Garden Mail's sole authority for provisioning provider-owned mail domains. */
export class MailDomainProvider extends Context.Service<
  MailDomainProvider,
  MailDomainProviderService
>()('@garden/server/MailDomainProvider') {}

const testProvider = ProviderKey.make('test-mail-domain-provider')

interface TestDomainProviderState {
  readonly nextSendingId: number
  readonly nextRoutingId: number
  readonly sending: ReadonlyMap<string, ProvisionedSendingSubdomain>
  readonly routing: ReadonlyMap<MailDomainZoneId, EmailRoutingState>
  readonly catchAll: ReadonlyMap<MailDomainZoneId, CatchAllWorkerDelivery>
}

const initialTestState: TestDomainProviderState = {
  nextSendingId: 1,
  nextRoutingId: 1,
  sending: new Map(),
  routing: new Map(),
  catchAll: new Map(),
}

/** Stable compound key prevents provider IDs from colliding across zones. */
const sendingKey = (
  zoneId: MailDomainZoneId,
  providerDomainId: ProviderObjectId,
): string => `${zoneId}:${providerDomainId}`

/** Returns the same fake registration when a domain is registered repeatedly. */
const findSendingByName = (
  state: TestDomainProviderState,
  input: SendingSubdomainRegistration,
): ProvisionedSendingSubdomain | undefined =>
  [...state.sending.values()].find(
    (domain) => domain.zoneId === input.zoneId && domain.name === input.name,
  )

/**
 * Fresh in-memory provider for workflow tests. Its identifiers and transitions
 * are deterministic, while absence follows the production typed error surface.
 */
export const testMailDomainProviderLayer = Layer.effect(
  MailDomainProvider,
  Effect.gen(function* () {
    const state = yield* Ref.make<TestDomainProviderState>(initialTestState)

    return MailDomainProvider.of({
      registerSendingSubdomain: Effect.fn(
        'MailDomainProvider.Test.registerSendingSubdomain',
      )(function* (input: SendingSubdomainRegistration) {
        const current = yield* Ref.get(state)
        const existing = findSendingByName(current, input)
        if (existing !== undefined) return existing

        const providerDomainId = ProviderObjectId.make(
          `test-sending-${current.nextSendingId}`,
        )
        const domain: ProvisionedSendingSubdomain = {
          provider: testProvider,
          zoneId: input.zoneId,
          providerDomainId,
          name: input.name,
          enabled: true,
          createdAt: null,
          modifiedAt: null,
          dkimSelector: null,
          previewEnabled: null,
          returnPathDomain: null,
        }

        yield* Ref.update(state, (value) => ({
          ...value,
          nextSendingId: value.nextSendingId + 1,
          sending: new Map(value.sending).set(
            sendingKey(input.zoneId, providerDomainId),
            domain,
          ),
        }))
        return domain
      }),
      inspectSendingSubdomain: Effect.fn(
        'MailDomainProvider.Test.inspectSendingSubdomain',
      )(function* (input: SendingSubdomainReference) {
        const domain = (yield* Ref.get(state)).sending.get(
          sendingKey(input.zoneId, input.providerDomainId),
        )
        if (domain !== undefined) return domain

        return yield* new MailDomainProviderNotFoundError({
          provider: testProvider,
          operation: 'inspectSendingSubdomain',
          resource: 'sending_subdomain',
          resourceId: input.providerDomainId,
          message: 'Sending subdomain does not exist in the test provider.',
        })
      }),
      deleteSendingSubdomain: Effect.fn(
        'MailDomainProvider.Test.deleteSendingSubdomain',
      )(function* (input: SendingSubdomainReference) {
        const key = sendingKey(input.zoneId, input.providerDomainId)
        const current = yield* Ref.get(state)
        if (!current.sending.has(key)) {
          return yield* new MailDomainProviderNotFoundError({
            provider: testProvider,
            operation: 'deleteSendingSubdomain',
            resource: 'sending_subdomain',
            resourceId: input.providerDomainId,
            message: 'Sending subdomain does not exist in the test provider.',
          })
        }

        yield* Ref.update(state, (value) => {
          const sending = new Map(value.sending)
          sending.delete(key)
          return { ...value, sending }
        })
      }),
      enableEmailRouting: Effect.fn(
        'MailDomainProvider.Test.enableEmailRouting',
      )(function* (input: EnableEmailRoutingInput) {
        const current = yield* Ref.get(state)
        const existing = current.routing.get(input.zoneId)
        if (existing !== undefined) {
          const enabled = { ...existing, enabled: true } as const
          yield* Ref.update(state, (value) => ({
            ...value,
            routing: new Map(value.routing).set(input.zoneId, enabled),
          }))
          return enabled
        }

        const routing: EmailRoutingState = {
          provider: testProvider,
          zoneId: input.zoneId,
          providerRoutingId: ProviderObjectId.make(
            `test-routing-${current.nextRoutingId}`,
          ),
          domain: input.domain,
          enabled: true,
          status: 'ready',
          createdAt: null,
          modifiedAt: null,
          wizardSkipped: null,
          supportsSubaddressing: null,
        }
        yield* Ref.update(state, (value) => ({
          ...value,
          nextRoutingId: value.nextRoutingId + 1,
          routing: new Map(value.routing).set(input.zoneId, routing),
        }))
        return routing
      }),
      inspectEmailRouting: Effect.fn(
        'MailDomainProvider.Test.inspectEmailRouting',
      )(function* (input: InspectEmailRoutingInput) {
        const routing = (yield* Ref.get(state)).routing.get(input.zoneId)
        if (routing !== undefined) return routing

        return yield* new MailDomainProviderNotFoundError({
          provider: testProvider,
          operation: 'inspectEmailRouting',
          resource: 'email_routing',
          resourceId: input.zoneId,
          message: 'Email Routing is not enabled in the test provider.',
        })
      }),
      setCatchAllWorkerDelivery: Effect.fn(
        'MailDomainProvider.Test.setCatchAllWorkerDelivery',
      )(function* (input: SetCatchAllWorkerDeliveryInput) {
        const current = yield* Ref.get(state)
        if (!current.routing.has(input.zoneId)) {
          return yield* new MailDomainProviderNotFoundError({
            provider: testProvider,
            operation: 'setCatchAllWorkerDelivery',
            resource: 'email_routing',
            resourceId: input.zoneId,
            message: 'Email Routing must be enabled before catch-all delivery.',
          })
        }

        const delivery: CatchAllWorkerDelivery = {
          provider: testProvider,
          zoneId: input.zoneId,
          providerRuleId: ProviderObjectId.make('test-catch-all'),
          workerName: input.workerName,
          enabled: true,
        }
        yield* Ref.update(state, (value) => ({
          ...value,
          catchAll: new Map(value.catchAll).set(input.zoneId, delivery),
        }))
        return delivery
      }),
    })
  }),
)
