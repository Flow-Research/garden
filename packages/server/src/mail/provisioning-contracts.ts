import {
  CreateMailboxInput,
  DomainName,
  LocalPart,
  MailAddress,
  MailActor,
  MailDomain,
  MailDomainId,
  Mailbox,
  MailboxAccess,
  MailboxAccessId,
  MailboxId,
  ProviderEvidence,
  SetMailboxAccessInput,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import { Context, Effect, Schema } from 'effect'
import type { MailDomainProviderError } from './domain-provider.ts'
import {
  CatchAllWorkerDelivery,
  EmailRoutingState,
  MailDomainZoneId,
  MailWorkerName,
  ProvisionedSendingSubdomain,
} from './domain-provider.ts'

export const ListProvisionedDomainsInput = Schema.Struct({
  workspaceId: WorkspaceId,
})
export interface ListProvisionedDomainsInput extends Schema.Schema.Type<
  typeof ListProvisionedDomainsInput
> {}

/** Cloudflare zone and deployed Worker are explicit onboarding authority. */
export const RegisterProvisionedDomainInput = Schema.Struct({
  workspaceId: WorkspaceId,
  name: DomainName,
  zoneId: MailDomainZoneId,
  workerName: MailWorkerName,
})
export interface RegisterProvisionedDomainInput extends Schema.Schema.Type<
  typeof RegisterProvisionedDomainInput
> {}

export const RefreshProvisionedDomainInput = Schema.Struct({
  workspaceId: WorkspaceId,
  domainId: MailDomainId,
})
export interface RefreshProvisionedDomainInput extends Schema.Schema.Type<
  typeof RefreshProvisionedDomainInput
> {}

export const ProvisionMailboxInput = CreateMailboxInput
export interface ProvisionMailboxInput extends Schema.Schema.Type<
  typeof ProvisionMailboxInput
> {}

/** Additional addresses cannot accidentally create a second primary address. */
export const CreateAdditionalMailAddressInput = Schema.TaggedUnion({
  Alias: {
    workspaceId: WorkspaceId,
    domainId: MailDomainId,
    mailboxId: MailboxId,
    localPart: LocalPart,
  },
  CatchAll: {
    workspaceId: WorkspaceId,
    domainId: MailDomainId,
    mailboxId: MailboxId,
  },
})
export type CreateAdditionalMailAddressInput =
  typeof CreateAdditionalMailAddressInput.Type

export const RemoveMailboxAccessInput = Schema.Struct({
  workspaceId: WorkspaceId,
  accessId: MailboxAccessId,
})
export interface RemoveMailboxAccessInput extends Schema.Schema.Type<
  typeof RemoveMailboxAccessInput
> {}

export const ProvisionedMailbox = Schema.Struct({
  mailbox: Mailbox,
  primaryAddress: MailAddress,
  ownerAccess: MailboxAccess,
})
export interface ProvisionedMailbox extends Schema.Schema.Type<
  typeof ProvisionedMailbox
> {}

const SendingProvisioningEvidence = Schema.Struct({
  enabled: Schema.Boolean,
  dkimSelector: Schema.NullOr(Schema.String),
  returnPathDomain: Schema.NullOr(DomainName),
  checkedAt: UtcTimestamp,
})

const RoutingProvisioningEvidence = Schema.Struct({
  enabled: Schema.Boolean,
  status: EmailRoutingState.fields.status,
  supportsSubaddressing: Schema.NullOr(Schema.Boolean),
  checkedAt: UtcTimestamp,
})

const CatchAllProvisioningEvidence = Schema.Struct({
  enabled: Schema.Boolean,
  providerRuleId: CatchAllWorkerDelivery.fields.providerRuleId,
  configuredAt: UtcTimestamp,
})

/** Strict shape stored inside the canonical provider-evidence JSON column. */
export const MailDomainProvisioningEvidence = Schema.Struct({
  zoneId: MailDomainZoneId,
  workerName: MailWorkerName,
  sending: Schema.NullOr(SendingProvisioningEvidence),
  routing: Schema.NullOr(RoutingProvisioningEvidence),
  catchAll: Schema.NullOr(CatchAllProvisioningEvidence),
})
export interface MailDomainProvisioningEvidence extends Schema.Schema.Type<
  typeof MailDomainProvisioningEvidence
> {}

/** A workspace-scoped provisioning resource does not exist. */
export class MailProvisioningNotFoundError extends Schema.TaggedErrorClass<MailProvisioningNotFoundError>()(
  'MailProvisioningNotFoundError',
  {
    workspaceId: WorkspaceId,
    resourceType: Schema.String,
    resourceId: Schema.String,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** A unique Internet address or domain is already owned elsewhere. */
export class MailProvisioningConflictError extends Schema.TaggedErrorClass<MailProvisioningConflictError>()(
  'MailProvisioningConflictError',
  {
    workspaceId: WorkspaceId,
    resourceType: Schema.String,
    value: Schema.String,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** A member or agent cannot be granted access outside its workspace. */
export class MailProvisioningActorError extends Schema.TaggedErrorClass<MailProvisioningActorError>()(
  'MailProvisioningActorError',
  {
    workspaceId: WorkspaceId,
    actor: MailActor,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** Persisted provider state is missing or cannot drive a safe refresh. */
export class MailProvisioningStateError extends Schema.TaggedErrorClass<MailProvisioningStateError>()(
  'MailProvisioningStateError',
  {
    workspaceId: WorkspaceId,
    domainId: MailDomainId,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Expected Postgres or persisted-row decoding failure. */
export class MailProvisioningPersistenceError extends Schema.TaggedErrorClass<MailProvisioningPersistenceError>()(
  'MailProvisioningPersistenceError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type MailProvisioningError =
  | MailProvisioningNotFoundError
  | MailProvisioningConflictError
  | MailProvisioningActorError
  | MailProvisioningStateError
  | MailProvisioningPersistenceError
  | MailDomainProviderError

export interface MailProvisioningService {
  readonly listDomains: (
    input: ListProvisionedDomainsInput,
  ) => Effect.Effect<ReadonlyArray<MailDomain>, MailProvisioningError>
  readonly registerDomain: (
    input: RegisterProvisionedDomainInput,
  ) => Effect.Effect<MailDomain, MailProvisioningError>
  readonly refreshDomain: (
    input: RefreshProvisionedDomainInput,
  ) => Effect.Effect<MailDomain, MailProvisioningError>
  readonly createMailbox: (
    input: ProvisionMailboxInput,
  ) => Effect.Effect<ProvisionedMailbox, MailProvisioningError>
  readonly createAddress: (
    input: CreateAdditionalMailAddressInput,
  ) => Effect.Effect<MailAddress, MailProvisioningError>
  readonly setMailboxAccess: (
    input: SetMailboxAccessInput,
  ) => Effect.Effect<MailboxAccess, MailProvisioningError>
  readonly removeMailboxAccess: (
    input: RemoveMailboxAccessInput,
  ) => Effect.Effect<void, MailProvisioningError>
}

/** Application authority for durable Garden Mail onboarding and administration. */
export class MailProvisioning extends Context.Service<
  MailProvisioning,
  MailProvisioningService
>()('@garden/server/MailProvisioning') {}

/** Converts strict evidence into the canonical JSON record without loose casts. */
export const providerEvidence = (
  evidence: MailDomainProvisioningEvidence,
): ProviderEvidence => ({
  zoneId: evidence.zoneId,
  workerName: evidence.workerName,
  sending: evidence.sending,
  routing: evidence.routing,
  catchAll: evidence.catchAll,
})

/** Captures the sending fields that remain useful after provider normalization. */
export const sendingEvidence = (
  sending: ProvisionedSendingSubdomain,
  checkedAt: UtcTimestamp,
): MailDomainProvisioningEvidence['sending'] => ({
  enabled: sending.enabled,
  dkimSelector: sending.dkimSelector,
  returnPathDomain: sending.returnPathDomain,
  checkedAt,
})
