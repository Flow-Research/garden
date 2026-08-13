import { and, eq, inArray, ne } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import type { ResumeResponse } from '@executor-js/execution/core'
import { mcpExecutionOwnerDirectoryFromNamespace } from '@executor-js/cloudflare/mcp/execution-owner-directory'
import { mcpSessionStub } from '@executor-js/cloudflare/mcp/session-stub'
import {
  ConversationId,
  gardenMailExecutorToolkitSlug,
  UpdateConversationStateInput,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import * as schema from '@garden/db/schema'
import { MailRepository, makeMailRepositoryLayer } from '@garden/server/mail'
import type { AppRequestContext } from './context'
import { requireMailMemberAuthority } from './mail-authority'
import {
  gardenMailApprovalTarget,
  gardenMailThreadMutation,
  MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES,
  type GardenMailThreadMutation,
} from './executor-engine/mail-toolkit'

export const MailExecutorApprovalInput = Schema.Struct({
  workspaceId: WorkspaceId,
  executionId: Schema.String,
  action: Schema.Literals(['accept', 'decline']),
})
export interface MailExecutorApprovalInput extends Schema.Schema.Type<
  typeof MailExecutorApprovalInput
> {}

export type MailExecutorApprovalResult = {
  readonly status: 'approved' | 'declined' | 'expired'
}

/** Mail approval could not be authorized or delivered to Executor. */
export class MailExecutorApprovalError extends Schema.TaggedErrorClass<MailExecutorApprovalError>()(
  'MailExecutorApprovalError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Reads the provider address from Executor's public paused-interaction shape. */
const pausedProviderAddress = (
  structured: Record<string, unknown>,
): unknown => {
  const interaction = structured.interaction
  return interaction && typeof interaction === 'object'
    ? Reflect.get(interaction, 'address')
    : undefined
}

/** Reads immutable provider arguments from Executor's paused interaction. */
const pausedProviderArgs = (structured: Record<string, unknown>): unknown => {
  const interaction = structured.interaction
  return interaction && typeof interaction === 'object'
    ? Reflect.get(interaction, 'args')
    : undefined
}

/** Applies one validated Gmail label mutation to the member-owned projection. */
export const approvedGmailThreadState = (input: {
  readonly mutation: GardenMailThreadMutation
  readonly current: {
    readonly lastReadMessageId: string | null
    readonly readAt: string | null
    readonly archivedAt: string | null
    readonly mutedAt: string | null
    readonly pinned: boolean
  } | null
  readonly latestMessageId: string | null
  readonly now: string
}) => {
  const added = new Set(input.mutation.addLabelIds)
  const removed = new Set(input.mutation.removeLabelIds)
  const read = removed.has('UNREAD') ? true : added.has('UNREAD') ? false : null
  return {
    lastReadMessageId:
      read === true
        ? input.latestMessageId
        : read === false
          ? null
          : (input.current?.lastReadMessageId ?? null),
    readAt:
      read === true
        ? input.now
        : read === false
          ? null
          : (input.current?.readAt ?? null),
    archivedAt: removed.has('INBOX')
      ? input.now
      : added.has('INBOX')
        ? null
        : (input.current?.archivedAt ?? null),
    mutedAt: input.current?.mutedAt ?? null,
    pinned: added.has('STARRED')
      ? true
      : removed.has('STARRED')
        ? false
        : (input.current?.pinned ?? false),
  }
}

/** True only after the exact approved provider invocation succeeded. */
export const approvedProviderMutationCompleted = (input: {
  readonly status: string
  readonly executionStatus?: string
  readonly isError?: boolean
  readonly structured?: Record<string, unknown>
}): boolean =>
  input.status === 'ok' &&
  input.isError !== true &&
  input.executionStatus === 'completed' &&
  input.structured?.executionOutcome === 'completed'

/**
 * Matches the immutable Executor toolkit resource to one server-resolved
 * active agent. Approval requests used to accept an unrelated browser agent
 * id; the paused session is now the only source of agent authority.
 */
export const resolveExecutorApprovalAgentId = async (input: {
  readonly resource: { readonly kind: string; readonly slug?: string }
  readonly workspaceId: string
  readonly userId: string
  readonly candidateAgentIds: readonly string[]
}): Promise<string | null> => {
  if (input.resource.kind !== 'toolkit' || !input.resource.slug) return null
  const candidates = await Promise.all(
    [...new Set(input.candidateAgentIds)].map(async (agentId) => ({
      agentId,
      toolkitSlug: await gardenMailExecutorToolkitSlug({
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentId,
      }),
    })),
  )
  return (
    candidates.find(
      (candidate) => candidate.toolkitSlug === input.resource.slug,
    )?.agentId ?? null
  )
}

/**
 * Revalidates the exact paused Gmail connection and session-bound agent against
 * current member∩agent mailbox authority, then records one human decision in
 * Executor's owning DO. The browser supplies only an opaque execution id; its
 * session route, toolkit resource, and provider address come from trusted DO
 * state.
 */
export const resolveMailExecutorApproval = Effect.fn(
  'GardenMail.resolveExecutorApproval',
)(function* (
  context: AppRequestContext,
  input: MailExecutorApprovalInput,
): Effect.fn.Return<MailExecutorApprovalResult, MailExecutorApprovalError> {
  const authority = yield* requireMailMemberAuthority(
    context,
    input.workspaceId,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailExecutorApprovalError({
          operation: 'authorizeMember',
          message: 'Mail action approval is not available.',
          cause,
        }),
    ),
  )
  const identity = {
    accountId: authority.userId,
    organizationId: input.workspaceId,
  }
  const ownerDirectory = mcpExecutionOwnerDirectoryFromNamespace(
    context.env.EXECUTOR_MCP_EXECUTION_OWNER,
  )
  if (ownerDirectory === null) {
    return yield* new MailExecutorApprovalError({
      operation: 'resolveOwnerDirectory',
      message: 'Mail action approval is not available.',
    })
  }
  const owner = yield* ownerDirectory.get(input.executionId).pipe(
    Effect.mapError(
      (cause) =>
        new MailExecutorApprovalError({
          operation: 'resolveExecutionOwner',
          message: 'Mail action approval is not available.',
          cause,
        }),
    ),
  )
  if (
    owner === null ||
    owner.accountId !== identity.accountId ||
    owner.organizationId !== identity.organizationId
  ) {
    return { status: 'expired' }
  }

  const session = mcpSessionStub(
    context.env.EXECUTOR_MCP_SESSION,
    owner.owner.sessionId,
  )
  const paused = yield* Effect.tryPromise({
    try: () =>
      session.getPausedExecutionForApproval(input.executionId, identity),
    catch: (cause) =>
      new MailExecutorApprovalError({
        operation: 'readPausedExecution',
        message: 'Mail action approval is not available.',
        cause,
      }),
  })
  if (paused.status !== 'ok') return { status: 'expired' }
  const target = gardenMailApprovalTarget(
    pausedProviderAddress(paused.structured),
  )
  const mutation = gardenMailThreadMutation(
    pausedProviderArgs(paused.structured),
  )
  if (target === null || mutation === null) {
    return yield* new MailExecutorApprovalError({
      operation: 'validatePausedAction',
      message: 'This mail action cannot be approved.',
    })
  }

  const scope = yield* Effect.tryPromise({
    try: async () => {
      const [account] = await authority.db
        .select({
          id: schema.mailSyncAccount.id,
          mailboxId: schema.mailSyncAccount.mailboxId,
        })
        .from(schema.mailSyncAccount)
        .where(
          and(
            eq(schema.mailSyncAccount.workspaceId, input.workspaceId),
            eq(schema.mailSyncAccount.userId, authority.userId),
            eq(schema.mailSyncAccount.provider, 'gmail'),
            eq(schema.mailSyncAccount.executorIntegration, 'google_gmail'),
            eq(
              schema.mailSyncAccount.executorConnectionName,
              target.connectionName,
            ),
            inArray(
              schema.mailSyncAccount.status,
              MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES,
            ),
          ),
        )
        .limit(1)
      if (account === undefined) return null
      const [conversation] = await authority.db
        .select({ id: schema.mailConversation.id })
        .from(schema.mailConversation)
        .where(
          and(
            eq(schema.mailConversation.workspaceId, input.workspaceId),
            eq(schema.mailConversation.mailboxId, account.mailboxId),
            eq(
              schema.mailConversation.threadKey,
              `gmail:${account.id}:${mutation.threadId}`,
            ),
          ),
        )
        .limit(1)
      if (conversation === undefined) return null
      const [memberAccess, agentAccess] = await Promise.all([
        authority.db
          .select({ mailboxId: schema.mailMailboxAccess.mailboxId })
          .from(schema.mailMailboxAccess)
          .where(
            and(
              eq(schema.mailMailboxAccess.workspaceId, input.workspaceId),
              eq(schema.mailMailboxAccess.mailboxId, account.mailboxId),
              eq(schema.mailMailboxAccess.actorType, 'member'),
              eq(schema.mailMailboxAccess.memberId, authority.actor.memberId),
              ne(schema.mailMailboxAccess.accessLevel, 'viewer'),
            ),
          )
          .limit(1),
        authority.db
          .select({ agentId: schema.mailMailboxAccess.agentId })
          .from(schema.mailMailboxAccess)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.mailMailboxAccess.agentId),
          )
          .where(
            and(
              eq(schema.mailMailboxAccess.workspaceId, input.workspaceId),
              eq(schema.mailMailboxAccess.mailboxId, account.mailboxId),
              eq(schema.mailMailboxAccess.actorType, 'agent'),
              ne(schema.mailMailboxAccess.accessLevel, 'viewer'),
              eq(schema.agent.workspaceId, input.workspaceId),
              eq(schema.agent.status, 'active'),
            ),
          ),
      ])
      if (!memberAccess[0]) return null
      const agentId = await resolveExecutorApprovalAgentId({
        resource: paused.resource,
        workspaceId: input.workspaceId,
        userId: authority.userId,
        candidateAgentIds: agentAccess.flatMap((access) =>
          access.agentId === null ? [] : [access.agentId],
        ),
      })
      return agentId === null ? null : { conversation }
    },
    catch: (cause) =>
      new MailExecutorApprovalError({
        operation: 'revalidateMailboxScope',
        message: 'Mail action approval is not available.',
        cause,
      }),
  })
  if (scope === null) {
    return yield* new MailExecutorApprovalError({
      operation: 'authorizePausedAction',
      message: 'This mail action is no longer authorized.',
    })
  }

  const response: ResumeResponse = { action: input.action }
  const resumed = yield* Effect.tryPromise({
    try: () =>
      session.resumeExecutionForApproval(input.executionId, identity, response),
    catch: (cause) =>
      new MailExecutorApprovalError({
        operation: 'resolvePausedExecution',
        message: 'Mail action approval could not be completed.',
        cause,
      }),
  })
  if (resumed.status !== 'ok') return { status: 'expired' }
  if (
    resumed.structured?.status === 'denied' ||
    resumed.structured?.status === 'canceled'
  ) {
    return { status: 'declined' }
  }
  if (!approvedProviderMutationCompleted(resumed)) {
    return yield* new MailExecutorApprovalError({
      operation: 'executeApprovedAction',
      message: 'Gmail could not complete the approved mail action.',
    })
  }

  yield* Effect.gen(function* () {
    const repository = yield* MailRepository
    const conversationId = yield* Schema.decodeUnknownEffect(ConversationId)(
      scope.conversation.id,
    )
    const detail = yield* repository.getConversation({
      workspaceId: input.workspaceId,
      actor: authority.actor,
      conversationId,
    })
    const now = UtcTimestamp.make(new Date().toISOString())
    const next = yield* Schema.decodeUnknownEffect(
      UpdateConversationStateInput,
    )({
      workspaceId: input.workspaceId,
      conversationId,
      actor: authority.actor,
      ...approvedGmailThreadState({
        mutation,
        current: detail.conversation.state,
        latestMessageId: detail.messages.at(-1)?.id ?? null,
        now,
      }),
    })
    yield* repository.updateConversationState(next)
  }).pipe(
    Effect.provide(makeMailRepositoryLayer(authority.db)),
    Effect.mapError(
      (cause) =>
        new MailExecutorApprovalError({
          operation: 'reconcileCanonicalState',
          message: 'Gmail changed, but Garden could not refresh the inbox.',
          cause,
        }),
    ),
  )
  return { status: 'approved' }
})
