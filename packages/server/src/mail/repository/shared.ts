import type { GardenDatabase } from '@garden/db'
import {
  mailConversation,
  mailConversationState,
  mailMailbox,
  mailMailboxAccess,
} from '@garden/db/schema'
import {
  ConversationId,
  MailActionActor,
  MailActor,
  MailboxId,
  WorkspaceId,
} from '@garden/core/mail'
import { and, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import {
  MailDraftRevisionConflictError,
  MailDraftSenderUnavailableError,
  MailRepositoryAccessDeniedError,
  MailRepositoryInvariantError,
  MailRepositoryNotFoundError,
  MailRepositoryPersistenceError,
  type MailRepositoryError,
} from './contracts.ts'

export type MailTransaction = Parameters<
  Parameters<GardenDatabase['transaction']>[0]
>[0]
export type MailDatabase = GardenDatabase | MailTransaction

export type StoredActor = {
  readonly actorType: 'member' | 'agent'
  readonly memberId: string | null
  readonly agentId: string | null
}

export type StoredActionActor = {
  readonly actorType: 'member' | 'agent' | 'system'
  readonly memberId: string | null
  readonly agentId: string | null
}

/** Maps the shared actor union to exclusive database discriminator columns. */
export const storedActor = (actor: MailActor): StoredActor =>
  actor._tag === 'Member'
    ? { actorType: 'member', memberId: actor.memberId, agentId: null }
    : { actorType: 'agent', memberId: null, agentId: actor.agentId }

/** Maps an auditable action actor to exclusive database columns. */
export const storedActionActor = (
  actor: MailActionActor,
): StoredActionActor => {
  if (actor._tag === 'Member') {
    return { actorType: 'member', memberId: actor.memberId, agentId: null }
  }
  if (actor._tag === 'Agent') {
    return { actorType: 'agent', memberId: null, agentId: actor.agentId }
  }
  return { actorType: 'system', memberId: null, agentId: null }
}

/** Restores a member or agent actor from checked database discriminator columns. */
export const mailActorValue = (row: {
  readonly actorType: string
  readonly memberId: string | null
  readonly agentId: string | null
}): unknown =>
  row.actorType === 'member'
    ? { _tag: 'Member', memberId: row.memberId }
    : { _tag: 'Agent', agentId: row.agentId }

/** Restores an auditable member, agent, or system actor from database columns. */
export const actionActorValue = (row: {
  readonly actorType: string
  readonly memberId: string | null
  readonly agentId: string | null
}): unknown => {
  if (row.actorType === 'member') {
    return { _tag: 'Member', memberId: row.memberId }
  }
  if (row.actorType === 'agent') {
    return { _tag: 'Agent', agentId: row.agentId }
  }
  return { _tag: 'System' }
}

/** Restores immutable message authorship without conflating external and system mail. */
export const messageAuthorValue = (row: {
  readonly authorType: string
  readonly authorMemberId: string | null
  readonly authorAgentId: string | null
}): unknown => {
  if (row.authorType === 'member') {
    return { _tag: 'Member', memberId: row.authorMemberId }
  }
  if (row.authorType === 'agent') {
    return { _tag: 'Agent', agentId: row.authorAgentId }
  }
  return row.authorType === 'system' ? { _tag: 'System' } : { _tag: 'External' }
}

/** Produces actor-specific mailbox access predicates without nullable sentinels. */
export const mailboxActorPredicate = (actor: MailActor) =>
  actor._tag === 'Member'
    ? and(
        eq(mailMailboxAccess.actorType, 'member'),
        eq(mailMailboxAccess.memberId, actor.memberId),
      )
    : and(
        eq(mailMailboxAccess.actorType, 'agent'),
        eq(mailMailboxAccess.agentId, actor.agentId),
      )

/** Produces actor-specific conversation state predicates. */
export const stateActorPredicate = (actor: MailActor) =>
  actor._tag === 'Member'
    ? and(
        eq(mailConversationState.actorType, 'member'),
        eq(mailConversationState.memberId, actor.memberId),
      )
    : and(
        eq(mailConversationState.actorType, 'agent'),
        eq(mailConversationState.agentId, actor.agentId),
      )

/** Converts valid database dates into canonical wire timestamps. */
export const timestamp = (value: Date | null): string | null =>
  value === null ? null : value.toISOString()

/** Converts a Drizzle Promise into a named, typed persistence effect. */
export const databaseEffect = <A>(
  operation: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, MailRepositoryPersistenceError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new MailRepositoryPersistenceError({
        reason: 'query',
        operation,
        message: 'Garden Mail persistence operation failed.',
        cause,
      }),
  })

/** Decodes database output so brands and enum checks survive the adapter boundary. */
export const decodeRow = <A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  operation: string,
): Effect.Effect<A, MailRepositoryPersistenceError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (cause) =>
        new MailRepositoryPersistenceError({
          reason: 'decode',
          operation,
          message: 'Garden Mail returned an invalid persisted value.',
          cause,
        }),
    ),
  )

/** Preserves typed repository failures crossing the Drizzle transaction callback. */
export const transactionFailure = (
  operation: string,
  cause: unknown,
): MailRepositoryError => {
  if (
    cause instanceof MailRepositoryAccessDeniedError ||
    cause instanceof MailRepositoryNotFoundError ||
    cause instanceof MailDraftRevisionConflictError ||
    cause instanceof MailDraftSenderUnavailableError ||
    cause instanceof MailRepositoryInvariantError ||
    cause instanceof MailRepositoryPersistenceError
  ) {
    return cause
  }
  return new MailRepositoryPersistenceError({
    reason: 'transaction',
    operation,
    message: 'Garden Mail transaction failed.',
    cause,
  })
}

/** Runs Effect orchestration inside one Drizzle transaction and preserves typed errors. */
export const inTransaction = <A>(
  db: GardenDatabase,
  operation: string,
  program: (tx: MailTransaction) => Effect.Effect<A, MailRepositoryError>,
): Effect.Effect<A, MailRepositoryError> =>
  Effect.tryPromise({
    try: () => db.transaction((tx) => Effect.runPromise(program(tx))),
    catch: (cause) => transactionFailure(operation, cause),
  })

/** Resolves a mailbox access row and enforces read or edit authority. */
export const requireMailboxAccess = Effect.fn(
  'MailRepository.requireMailboxAccess',
)(function* (
  db: MailDatabase,
  input: {
    readonly workspaceId: WorkspaceId
    readonly mailboxId: MailboxId
    readonly actor: MailActor
    readonly write: boolean
    readonly operation: string
  },
) {
  const rows = yield* databaseEffect(input.operation, () =>
    db
      .select({ accessLevel: mailMailboxAccess.accessLevel })
      .from(mailMailboxAccess)
      .innerJoin(
        mailMailbox,
        and(
          eq(mailMailbox.id, mailMailboxAccess.mailboxId),
          eq(mailMailbox.workspaceId, mailMailboxAccess.workspaceId),
        ),
      )
      .where(
        and(
          eq(mailMailboxAccess.workspaceId, input.workspaceId),
          eq(mailMailboxAccess.mailboxId, input.mailboxId),
          eq(mailMailbox.status, 'active'),
          mailboxActorPredicate(input.actor),
        ),
      )
      .limit(1),
  )
  const access = rows[0]
  if (
    access === undefined ||
    (input.write && access.accessLevel === 'viewer')
  ) {
    return yield* new MailRepositoryAccessDeniedError({
      workspaceId: input.workspaceId,
      resourceType: 'mailbox',
      resourceId: input.mailboxId,
      operation: input.operation,
      message: 'Actor does not have the required mailbox access.',
    })
  }
  return access.accessLevel
})

/** Resolves a conversation and proves its mailbox is visible to the actor. */
export const requireConversationAccess = Effect.fn(
  'MailRepository.requireConversationAccess',
)(function* (
  db: MailDatabase,
  input: {
    readonly workspaceId: WorkspaceId
    readonly conversationId: ConversationId
    readonly actor: MailActor
    readonly write: boolean
    readonly operation: string
  },
) {
  const rows = yield* databaseEffect(input.operation, () =>
    db
      .select({ conversation: mailConversation })
      .from(mailConversation)
      .where(
        and(
          eq(mailConversation.workspaceId, input.workspaceId),
          eq(mailConversation.id, input.conversationId),
        ),
      )
      .limit(1),
  )
  const row = rows[0]
  if (row === undefined) {
    return yield* new MailRepositoryAccessDeniedError({
      workspaceId: input.workspaceId,
      resourceType: 'conversation',
      resourceId: input.conversationId,
      operation: input.operation,
      message: 'Conversation is not accessible to this actor.',
    })
  }
  yield* requireMailboxAccess(db, {
    workspaceId: input.workspaceId,
    mailboxId: MailboxId.make(row.conversation.mailboxId),
    actor: input.actor,
    write: input.write,
    operation: input.operation,
  })
  return row.conversation
})

/** Maps a nullable persisted state row into the actor-owned projection. */
export const conversationStateValue = (
  state: {
    readonly lastReadMessageId: string | null
    readonly readAt: Date | null
    readonly archivedAt: Date | null
    readonly mutedAt: Date | null
    readonly pinned: boolean
  } | null,
): unknown =>
  state === null
    ? null
    : {
        lastReadMessageId: state.lastReadMessageId,
        readAt: timestamp(state.readAt),
        archivedAt: timestamp(state.archivedAt),
        mutedAt: timestamp(state.mutedAt),
        pinned: state.pinned,
      }
