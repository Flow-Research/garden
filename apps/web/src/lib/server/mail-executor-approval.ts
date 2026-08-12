import { and, eq, inArray, ne } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import type { ResumeResponse } from '@executor-js/execution/core'
import { mcpExecutionOwnerDirectoryFromNamespace } from '@executor-js/cloudflare/mcp/execution-owner-directory'
import { mcpSessionStub } from '@executor-js/cloudflare/mcp/session-stub'
import { AgentId, WorkspaceId } from '@garden/core/mail'
import * as schema from '@garden/db/schema'
import type { AppRequestContext } from './context'
import { requireMailMemberAuthority } from './mail-authority'
import {
  gardenMailApprovalTarget,
  MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES,
} from './executor-engine/mail-toolkit'

export const MailExecutorApprovalInput = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
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

/**
 * Revalidates the exact paused Gmail connection against current member∩agent
 * mailbox authority, then records one human decision in Executor's owning DO.
 * The browser supplies only an opaque execution id; its session route and
 * provider address are recovered from trusted Durable Object state.
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
  if (target === null) {
    return yield* new MailExecutorApprovalError({
      operation: 'validatePausedAction',
      message: 'This mail action cannot be approved.',
    })
  }

  const scope = yield* Effect.tryPromise({
    try: async () => {
      const [account] = await authority.db
        .select({ mailboxId: schema.mailSyncAccount.mailboxId })
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
          .select({ mailboxId: schema.mailMailboxAccess.mailboxId })
          .from(schema.mailMailboxAccess)
          .where(
            and(
              eq(schema.mailMailboxAccess.workspaceId, input.workspaceId),
              eq(schema.mailMailboxAccess.mailboxId, account.mailboxId),
              eq(schema.mailMailboxAccess.actorType, 'agent'),
              eq(schema.mailMailboxAccess.agentId, input.agentId),
              ne(schema.mailMailboxAccess.accessLevel, 'viewer'),
            ),
          )
          .limit(1),
      ])
      return memberAccess[0] && agentAccess[0] ? account : null
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
  return resumed.status === 'ok'
    ? { status: input.action === 'accept' ? 'approved' : 'declined' }
    : { status: 'expired' }
})
