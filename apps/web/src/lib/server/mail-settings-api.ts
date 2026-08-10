import {
  CreateMailboxInput,
  ProviderKey,
  SetMailboxAccessInput,
  WorkspaceId,
} from '@garden/core/mail'
import { schema } from '@garden/db/runtime'
import {
  CloudflareDomainProviderConfig,
  CreateAdditionalMailAddressInput,
  MailDomainProvisioningEvidence,
  MailDomainProvider,
  MailDomainProviderRequestError,
  MailProvisioning,
  RefreshProvisionedDomainInput,
  RegisterProvisionedDomainInput,
  RemoveMailboxAccessInput,
  cloudflareDomainProviderLayer,
  makeMailProvisioningLayer,
  type MailProvisioningService,
} from '@garden/server/mail'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import type {
  CreateMailAddressSettingsInput,
  CreateMailboxSettingsInput,
  MailAddressSettingsView,
  MailboxAccessSettingsView,
  MailboxSettingsView,
  MailDomainSettingsView,
  MailSettingsActorView,
  RegisterMailDomainSettingsInput,
  SetMailboxAccessSettingsInput,
} from '@/features/settings/mail-settings-contracts'
import type { AppRequestContext } from './context'
import {
  requireMailAdministrator,
  requireMailMemberAuthority,
} from './mail-authority'

const MailDomainStatus = Schema.Literals([
  'pending_verification',
  'active',
  'suspended',
  'failed',
])
const MailboxKind = Schema.Literals(['personal', 'shared', 'agent'])
const MailboxStatus = Schema.Literals(['active', 'disabled'])
const MailAddressKind = Schema.Literals(['primary', 'alias', 'catch_all'])
const MailAddressStatus = Schema.Literals(['active', 'disabled'])
const MailboxAccessLevel = Schema.Literals(['owner', 'editor', 'viewer'])

export type MailSettingsSnapshot = {
  canManage: boolean
  domains: MailDomainSettingsView[]
  mailboxes: MailboxSettingsView[]
  actors: MailSettingsActorView[]
}

/** Mail settings rows could not be loaded from request-scoped Postgres. */
export class MailSettingsPersistenceError extends Schema.TaggedErrorClass<MailSettingsPersistenceError>()(
  'MailSettingsPersistenceError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Persisted mail relationships could not form a safe settings projection. */
export class MailSettingsProjectionError extends Schema.TaggedErrorClass<MailSettingsProjectionError>()(
  'MailSettingsProjectionError',
  {
    resourceType: Schema.String,
    resourceId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Converts Promise-only Drizzle execution into one named typed Effect seam. */
const databaseQuery = <A>(
  operation: string,
  query: () => Promise<A>,
): Effect.Effect<A, MailSettingsPersistenceError> =>
  Effect.tryPromise({
    try: query,
    catch: (cause) =>
      new MailSettingsPersistenceError({
        operation,
        message: 'Garden could not load mail administration data.',
        cause,
      }),
  })

/** Provider evidence is optional until registration has reached its first checkpoint. */
const projectDomain = Effect.fn('GardenMailSettings.projectDomain')(function* (
  row: typeof schema.mailDomain.$inferSelect,
) {
  const status = yield* Schema.decodeUnknownEffect(MailDomainStatus)(
    row.status,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailSettingsProjectionError({
          resourceType: 'domain',
          resourceId: row.id,
          message: 'Mail domain status is invalid.',
          cause,
        }),
    ),
  )
  const evidence =
    row.providerEvidence === null
      ? null
      : yield* Schema.decodeUnknownEffect(MailDomainProvisioningEvidence)(
          row.providerEvidence,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new MailSettingsProjectionError({
                resourceType: 'domain',
                resourceId: row.id,
                message: 'Mail domain provider evidence is invalid.',
                cause,
              }),
          ),
        )
  const observations = [
    evidence?.sending?.checkedAt,
    evidence?.routing?.checkedAt,
    evidence?.catchAll?.configuredAt,
  ].filter((value) => value !== undefined)
  const checkedAt = observations.sort().at(-1)
  const checkedAtLabel = checkedAt
    ? new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(checkedAt))
    : undefined

  return {
    id: row.id,
    name: row.name,
    status,
    sendingEnabled: evidence?.sending?.enabled ?? false,
    routingEnabled: evidence?.routing?.enabled ?? false,
    catchAllEnabled: evidence?.catchAll?.enabled ?? false,
    ...(checkedAtLabel ? { checkedAtLabel } : {}),
  } satisfies MailDomainSettingsView
})

/** Access rows must resolve to a real workspace actor before reaching the UI. */
const projectAccess = Effect.fn('GardenMailSettings.projectAccess')(function* (
  row: typeof schema.mailMailboxAccess.$inferSelect,
  actors: ReadonlyMap<string, MailSettingsActorView>,
) {
  const actorId = row.actorType === 'member' ? row.memberId : row.agentId
  const actor = actorId ? actors.get(`${row.actorType}:${actorId}`) : undefined
  if (!actor) {
    return yield* new MailSettingsProjectionError({
      resourceType: 'mailbox_access',
      resourceId: row.id,
      message: 'Mailbox access references an unavailable workspace actor.',
    })
  }
  const level = yield* Schema.decodeUnknownEffect(MailboxAccessLevel)(
    row.accessLevel,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailSettingsProjectionError({
          resourceType: 'mailbox_access',
          resourceId: row.id,
          message: 'Mailbox access level is invalid.',
          cause,
        }),
    ),
  )
  return { id: row.id, actor, level } satisfies MailboxAccessSettingsView
})

/** Builds the real workspace administration projection from canonical rows. */
const loadSnapshot = Effect.fn('GardenMailSettings.loadSnapshot')(function* (
  context: AppRequestContext,
  workspaceId: typeof WorkspaceId.Type,
) {
  const authority = yield* requireMailMemberAuthority(context, workspaceId)
  const db = authority.db
  const rows = yield* Effect.all(
    {
      domains: databaseQuery('domains.list', async () =>
        db
          .select()
          .from(schema.mailDomain)
          .where(eq(schema.mailDomain.workspaceId, workspaceId))
          .orderBy(asc(schema.mailDomain.name)),
      ),
      mailboxes: databaseQuery('mailboxes.list', async () =>
        db
          .select()
          .from(schema.mailMailbox)
          .where(eq(schema.mailMailbox.workspaceId, workspaceId))
          .orderBy(asc(schema.mailMailbox.name)),
      ),
      addresses: databaseQuery('addresses.list', async () =>
        db
          .select()
          .from(schema.mailAddress)
          .where(eq(schema.mailAddress.workspaceId, workspaceId))
          .orderBy(asc(schema.mailAddress.localPart)),
      ),
      access: databaseQuery('access.list', async () =>
        db
          .select()
          .from(schema.mailMailboxAccess)
          .where(eq(schema.mailMailboxAccess.workspaceId, workspaceId))
          .orderBy(asc(schema.mailMailboxAccess.createdAt)),
      ),
      members: databaseQuery('members.list', async () =>
        db
          .select({
            id: schema.member.id,
            name: schema.user.name,
            email: schema.user.email,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, workspaceId))
          .orderBy(asc(schema.user.name)),
      ),
      agents: databaseQuery('agents.list', async () =>
        db
          .select({
            id: schema.agent.id,
            name: schema.agent.name,
            roleTitle: schema.agent.roleTitle,
          })
          .from(schema.agent)
          .where(
            and(
              eq(schema.agent.workspaceId, workspaceId),
              eq(schema.agent.status, 'active'),
            ),
          )
          .orderBy(asc(schema.agent.name)),
      ),
    },
    { concurrency: 6 },
  )

  const actors: MailSettingsActorView[] = [
    ...rows.members.map((member) => ({
      type: 'member' as const,
      id: member.id,
      name: member.name || member.email,
      detail: member.email,
    })),
    ...rows.agents.map((agent) => ({
      type: 'agent' as const,
      id: agent.id,
      name: agent.name,
      detail: agent.roleTitle ?? 'Garden agent',
    })),
  ]
  const actorMap = new Map(
    actors.map((actor) => [`${actor.type}:${actor.id}`, actor]),
  )
  const domainViews = yield* Effect.forEach(rows.domains, projectDomain)
  const domainNames = new Map(
    domainViews.map((domain) => [domain.id, domain.name]),
  )
  const accessViews = yield* Effect.forEach(rows.access, (row) =>
    projectAccess(row, actorMap),
  )
  const accessMailboxIds = new Map(
    rows.access.map((row) => [row.id, row.mailboxId]),
  )

  const mailboxes = yield* Effect.forEach(rows.mailboxes, (mailbox) =>
    Effect.gen(function* () {
      const kind = yield* Schema.decodeUnknownEffect(MailboxKind)(mailbox.kind)
      const status = yield* Schema.decodeUnknownEffect(MailboxStatus)(
        mailbox.status,
      )
      const mailboxAddresses = rows.addresses.filter(
        (address) => address.mailboxId === mailbox.id,
      )
      const primary = mailboxAddresses.find(
        (address) => address.kind === 'primary',
      )
      if (!primary) {
        return yield* new MailSettingsProjectionError({
          resourceType: 'mailbox',
          resourceId: mailbox.id,
          message: 'Mailbox has no primary address.',
        })
      }
      const domainName = domainNames.get(primary.domainId)
      if (!domainName) {
        return yield* new MailSettingsProjectionError({
          resourceType: 'mailbox',
          resourceId: mailbox.id,
          message: 'Mailbox primary address has no workspace domain.',
        })
      }
      const addresses = yield* Effect.forEach(mailboxAddresses, (address) =>
        Effect.gen(function* () {
          const addressDomain = domainNames.get(address.domainId)
          if (!addressDomain) {
            return yield* new MailSettingsProjectionError({
              resourceType: 'mail_address',
              resourceId: address.id,
              message: 'Mail address has no workspace domain.',
            })
          }
          const addressKind = yield* Schema.decodeUnknownEffect(
            MailAddressKind,
          )(address.kind)
          const addressStatus = yield* Schema.decodeUnknownEffect(
            MailAddressStatus,
          )(address.status)
          return {
            id: address.id,
            address: `${address.localPart}@${addressDomain}`,
            kind: addressKind,
            status: addressStatus,
          } satisfies MailAddressSettingsView
        }),
      )
      return {
        id: mailbox.id,
        domainId: primary.domainId,
        name: mailbox.name,
        kind,
        status,
        primaryAddress: `${primary.localPart}@${domainName}`,
        addresses,
        access: accessViews.filter(
          (access) => accessMailboxIds.get(access.id) === mailbox.id,
        ),
      } satisfies MailboxSettingsView
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof MailSettingsProjectionError
          ? cause
          : new MailSettingsProjectionError({
              resourceType: 'mailbox',
              resourceId: mailbox.id,
              message: 'Mailbox projection contains an invalid value.',
              cause,
            }),
      ),
    ),
  )

  return {
    canManage: authority.role === 'owner' || authority.role === 'admin',
    domains: domainViews,
    mailboxes,
    actors,
  } satisfies MailSettingsSnapshot
})

const cloudflareProvider = ProviderKey.make('cloudflare-email-service')

/**
 * Keeps persistence-only mailbox administration available without provider
 * credentials. Domain commands still fail through their typed provider channel.
 */
const unavailableProviderLayer = Layer.succeed(
  MailDomainProvider,
  MailDomainProvider.of({
    registerSendingSubdomain: () =>
      Effect.fail(
        new MailDomainProviderRequestError({
          provider: cloudflareProvider,
          operation: 'registerSendingSubdomain',
          message: 'Cloudflare Mail provider credentials are not configured.',
        }),
      ),
    inspectSendingSubdomain: () =>
      Effect.fail(
        new MailDomainProviderRequestError({
          provider: cloudflareProvider,
          operation: 'inspectSendingSubdomain',
          message: 'Cloudflare Mail provider credentials are not configured.',
        }),
      ),
    deleteSendingSubdomain: () =>
      Effect.fail(
        new MailDomainProviderRequestError({
          provider: cloudflareProvider,
          operation: 'deleteSendingSubdomain',
          message: 'Cloudflare Mail provider credentials are not configured.',
        }),
      ),
    enableEmailRouting: () =>
      Effect.fail(
        new MailDomainProviderRequestError({
          provider: cloudflareProvider,
          operation: 'enableEmailRouting',
          message: 'Cloudflare Mail provider credentials are not configured.',
        }),
      ),
    inspectEmailRouting: () =>
      Effect.fail(
        new MailDomainProviderRequestError({
          provider: cloudflareProvider,
          operation: 'inspectEmailRouting',
          message: 'Cloudflare Mail provider credentials are not configured.',
        }),
      ),
    setCatchAllWorkerDelivery: () =>
      Effect.fail(
        new MailDomainProviderRequestError({
          provider: cloudflareProvider,
          operation: 'setCatchAllWorkerDelivery',
          message: 'Cloudflare Mail provider credentials are not configured.',
        }),
      ),
  }),
)

/** Creates the managed provider/provisioning layer from Worker bindings. */
const provisioningLayer = (
  context: AppRequestContext,
  db: Parameters<typeof makeMailProvisioningLayer>[0],
) => {
  const token = context.env.CLOUDFLARE_MAIL_API_TOKEN
  const providerLayer = token
    ? cloudflareDomainProviderLayer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(
              CloudflareDomainProviderConfig,
              CloudflareDomainProviderConfig.of({
                apiBaseUrl:
                  context.env.CLOUDFLARE_MAIL_API_BASE_URL ??
                  'https://api.cloudflare.com/client/v4',
                apiToken: Redacted.make(token),
              }),
            ),
            FetchHttpClient.layer,
          ),
        ),
      )
    : unavailableProviderLayer

  return makeMailProvisioningLayer(db).pipe(Layer.provide(providerLayer))
}

/** Decodes request authority and runs one administrator-only service command. */
const withAdministratorProvisioning = <A, E>(
  context: AppRequestContext,
  rawWorkspaceId: string,
  command: (
    provisioning: MailProvisioningService,
    workspaceId: typeof WorkspaceId.Type,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const workspaceId =
      yield* Schema.decodeUnknownEffect(WorkspaceId)(rawWorkspaceId)
    const authority = yield* requireMailMemberAuthority(context, workspaceId)
    yield* requireMailAdministrator(authority, workspaceId)
    const layer = provisioningLayer(context, authority.db)
    return yield* Effect.gen(function* () {
      const provisioning = yield* MailProvisioning
      return yield* command(provisioning, workspaceId)
    }).pipe(Effect.provide(layer))
  })

/** Returns the authenticated workspace's complete mail administration state. */
export async function getMailSettingsSnapshot(
  context: AppRequestContext,
  rawWorkspaceId: string,
): Promise<MailSettingsSnapshot> {
  return await Effect.runPromise(
    Schema.decodeUnknownEffect(WorkspaceId)(rawWorkspaceId).pipe(
      Effect.flatMap((workspaceId) => loadSnapshot(context, workspaceId)),
    ),
  )
}

/** Registers and verifies a managed company domain. */
export async function registerMailSettingsDomain(
  context: AppRequestContext,
  rawWorkspaceId: string,
  input: RegisterMailDomainSettingsInput,
) {
  return await Effect.runPromise(
    withAdministratorProvisioning(
      context,
      rawWorkspaceId,
      (provisioning, workspaceId) =>
        Schema.decodeUnknownEffect(RegisterProvisionedDomainInput)({
          workspaceId,
          name: input.name,
          zoneId: input.zoneId,
          workerName: input.workerName,
        }).pipe(
          Effect.flatMap((canonical) =>
            provisioning
              .registerDomain(canonical)
              .pipe(Effect.map((domain) => domain.id)),
          ),
        ),
    ),
  )
}

/** Re-inspects Cloudflare sending and routing evidence for one domain. */
export async function refreshMailSettingsDomain(
  context: AppRequestContext,
  rawWorkspaceId: string,
  domainId: string,
) {
  return await Effect.runPromise(
    withAdministratorProvisioning(
      context,
      rawWorkspaceId,
      (provisioning, workspaceId) =>
        Schema.decodeUnknownEffect(RefreshProvisionedDomainInput)({
          workspaceId,
          domainId,
        }).pipe(
          Effect.flatMap((canonical) =>
            provisioning
              .refreshDomain(canonical)
              .pipe(Effect.map((domain) => domain.id)),
          ),
        ),
    ),
  )
}

/** Creates a mailbox, primary address, and owner access atomically. */
export async function createMailSettingsMailbox(
  context: AppRequestContext,
  rawWorkspaceId: string,
  input: CreateMailboxSettingsInput,
) {
  return await Effect.runPromise(
    withAdministratorProvisioning(
      context,
      rawWorkspaceId,
      (provisioning, workspaceId) =>
        Schema.decodeUnknownEffect(CreateMailboxInput)({
          workspaceId,
          domainId: input.domainId,
          name: input.name,
          kind: input.kind,
          primaryLocalPart: input.primaryLocalPart,
          owner:
            input.owner.type === 'member'
              ? { _tag: 'Member', memberId: input.owner.id }
              : { _tag: 'Agent', agentId: input.owner.id },
        }).pipe(
          Effect.flatMap((canonical) =>
            provisioning
              .createMailbox(canonical)
              .pipe(Effect.map((created) => created.mailbox.id)),
          ),
        ),
    ),
  )
}

/** Creates an alias or catch-all address for an existing mailbox. */
export async function createMailSettingsAddress(
  context: AppRequestContext,
  rawWorkspaceId: string,
  input: CreateMailAddressSettingsInput,
) {
  return await Effect.runPromise(
    withAdministratorProvisioning(
      context,
      rawWorkspaceId,
      (provisioning, workspaceId) =>
        Schema.decodeUnknownEffect(CreateAdditionalMailAddressInput)(
          input.kind === 'alias'
            ? {
                _tag: 'Alias',
                workspaceId,
                domainId: input.domainId,
                mailboxId: input.mailboxId,
                localPart: input.localPart,
              }
            : {
                _tag: 'CatchAll',
                workspaceId,
                domainId: input.domainId,
                mailboxId: input.mailboxId,
              },
        ).pipe(
          Effect.flatMap((canonical) =>
            provisioning
              .createAddress(canonical)
              .pipe(Effect.map((address) => address.id)),
          ),
        ),
    ),
  )
}

/** Grants or updates a workspace member/agent's mailbox access. */
export async function setMailSettingsAccess(
  context: AppRequestContext,
  rawWorkspaceId: string,
  input: SetMailboxAccessSettingsInput,
) {
  return await Effect.runPromise(
    withAdministratorProvisioning(
      context,
      rawWorkspaceId,
      (provisioning, workspaceId) =>
        Schema.decodeUnknownEffect(SetMailboxAccessInput)({
          workspaceId,
          mailboxId: input.mailboxId,
          actor:
            input.actor.type === 'member'
              ? { _tag: 'Member', memberId: input.actor.id }
              : { _tag: 'Agent', agentId: input.actor.id },
          accessLevel: input.level,
        }).pipe(
          Effect.flatMap((canonical) =>
            provisioning
              .setMailboxAccess(canonical)
              .pipe(Effect.map((access) => access.id)),
          ),
        ),
    ),
  )
}

/** Removes non-owner mailbox access through the provisioning invariant. */
export async function removeMailSettingsAccess(
  context: AppRequestContext,
  rawWorkspaceId: string,
  accessId: string,
) {
  return await Effect.runPromise(
    withAdministratorProvisioning(
      context,
      rawWorkspaceId,
      (provisioning, workspaceId) =>
        Schema.decodeUnknownEffect(RemoveMailboxAccessInput)({
          workspaceId,
          accessId,
        }).pipe(
          Effect.flatMap((canonical) =>
            provisioning
              .removeMailboxAccess(canonical)
              .pipe(Effect.as(accessId)),
          ),
        ),
    ),
  )
}
