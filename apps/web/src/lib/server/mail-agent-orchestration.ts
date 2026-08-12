import { getAgentByName } from 'agents'
import { and, eq, isNull } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import {
  AgentId,
  ConversationId,
  MailboxId,
  WorkspaceId,
} from '@garden/core/mail'
import { MailAgentConversationContext } from '@garden/agent-runtime'
import { disposeRpcResult } from '@garden/app-state/platform/rpc'
import type { AgentChatSession } from '@garden/core/types'
import { schema, type Db } from './db'
import type { AppEnv } from './env'
import { toChatThread } from './control-plane'

/** Manual mail collaboration session could not be authorized or prepared. */
export class MailAgentOrchestrationError extends Schema.TaggedErrorClass<MailAgentOrchestrationError>()(
  'MailAgentOrchestrationError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const MAIL_CHAT_UUID_NAMESPACE = '28ad243e-f655-5a4d-bf5a-2309351ec75e'
const AGENT_ROUTING_RETRY = { maxAttempts: 3 }

export const MailAgentChatSessionInput = Schema.Struct({
  workspaceId: WorkspaceId,
  ownerUserId: Schema.String.check(Schema.isUUID()),
  conversationId: ConversationId,
  agentId: AgentId,
})
export interface MailAgentChatSessionInput extends Schema.Schema.Type<
  typeof MailAgentChatSessionInput
> {}

type ResolvedMailAgentAuthority = {
  readonly agentId: string
  readonly hostName: string
  readonly mailboxId: string
  readonly subject: string
  readonly needsHostName: boolean
}

export type MailAgentChatSession = AgentChatSession & {
  readonly conversationId: string
  readonly mailboxId: string
}

const uuidBytes = (uuid: string) =>
  Uint8Array.from(
    uuid
      .replaceAll('-', '')
      .match(/.{2}/g)
      ?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  )

const formatUuid = (bytes: Uint8Array) => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

/**
 * Produces RFC 4122 UUIDv5 so one member/agent/conversation always resolves to
 * one hidden chat row without a second mapping table. Web Crypto SHA-1 is used
 * only for UUID identity, never for security or content integrity.
 */
const mailChatThreadId = Effect.fn('MailAgent.chatThreadId')(function* (
  input: MailAgentChatSessionInput,
) {
  const namespace = uuidBytes(MAIL_CHAT_UUID_NAMESPACE)
  const name = new TextEncoder().encode(
    `${input.workspaceId}:${input.ownerUserId}:${input.agentId}:${input.conversationId}`,
  )
  const source = new Uint8Array(namespace.length + name.length)
  source.set(namespace)
  source.set(name, namespace.length)
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-1', source),
    catch: (cause) =>
      new MailAgentOrchestrationError({
        operation: 'chatThreadId.digest',
        message: 'Garden could not derive the mail chat identity.',
        cause,
      }),
  })
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes)
})

/** Resolves the assignment, mailbox access, agent host, and conversation title. */
const resolveMailAgentAuthority = Effect.fn('MailAgent.resolveAuthority')(
  function* (db: Db, input: MailAgentChatSessionInput) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            agentId: schema.agent.id,
            hostName: schema.agent.hostName,
            mailboxId: schema.mailConversation.mailboxId,
            subject: schema.mailConversation.subject,
          })
          .from(schema.mailConversation)
          .innerJoin(
            schema.mailConversationAssignment,
            and(
              eq(
                schema.mailConversationAssignment.conversationId,
                schema.mailConversation.id,
              ),
              eq(
                schema.mailConversationAssignment.workspaceId,
                input.workspaceId,
              ),
              eq(schema.mailConversationAssignment.assigneeType, 'agent'),
              eq(
                schema.mailConversationAssignment.assigneeAgentId,
                input.agentId,
              ),
              isNull(schema.mailConversationAssignment.unassignedAt),
            ),
          )
          .innerJoin(
            schema.mailMailboxAccess,
            and(
              eq(
                schema.mailMailboxAccess.mailboxId,
                schema.mailConversation.mailboxId,
              ),
              eq(schema.mailMailboxAccess.workspaceId, input.workspaceId),
              eq(schema.mailMailboxAccess.actorType, 'agent'),
              eq(schema.mailMailboxAccess.agentId, input.agentId),
            ),
          )
          .innerJoin(
            schema.agent,
            and(
              eq(schema.agent.id, input.agentId),
              eq(schema.agent.workspaceId, input.workspaceId),
              eq(schema.agent.status, 'active'),
            ),
          )
          .where(
            and(
              eq(schema.mailConversation.id, input.conversationId),
              eq(schema.mailConversation.workspaceId, input.workspaceId),
            ),
          )
          .limit(1),
      catch: (cause) =>
        new MailAgentOrchestrationError({
          operation: 'resolveAuthority.select',
          message: 'Garden could not resolve the assigned mail agent.',
          cause,
        }),
    })
    const row = rows[0]
    if (!row) {
      return yield* new MailAgentOrchestrationError({
        operation: 'resolveAuthority',
        message: 'Assigned mail agent access was not found.',
      })
    }
    return {
      ...row,
      hostName: row.hostName ?? row.agentId,
      needsHostName: row.hostName === null,
    } satisfies ResolvedMailAgentAuthority
  },
)

/** Creates the hidden collaboration chat once and preserves its stable runtime. */
const ensureMailChatThread = Effect.fn('MailAgent.ensureChatThread')(function* (
  db: Db,
  input: MailAgentChatSessionInput,
  authority: ResolvedMailAgentAuthority,
) {
  const threadId = yield* mailChatThreadId(input)
  const rows = yield* Effect.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        if (authority.needsHostName) {
          await tx
            .update(schema.agent)
            .set({ hostName: authority.agentId })
            .where(eq(schema.agent.id, authority.agentId))
        }
        await tx
          .insert(schema.chatThread)
          .values({
            id: threadId,
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId,
            agentId: input.agentId,
            runtimeKind: 'chat',
            runtimeKey: threadId,
            title: authority.subject.trim() || 'Mail conversation',
            lastMessage: '',
            archivedAt: new Date(0),
          })
          .onConflictDoNothing({ target: schema.chatThread.id })
        return await tx
          .select()
          .from(schema.chatThread)
          .where(
            and(
              eq(schema.chatThread.id, threadId),
              eq(schema.chatThread.workspaceId, input.workspaceId),
              eq(schema.chatThread.ownerUserId, input.ownerUserId),
              eq(schema.chatThread.agentId, input.agentId),
            ),
          )
          .limit(1)
      }),
    catch: (cause) =>
      new MailAgentOrchestrationError({
        operation: 'ensureChatThread.transaction',
        message: 'Garden could not prepare the mail collaboration chat.',
        cause,
      }),
  })
  const thread = rows[0]
  if (!thread) {
    return yield* new MailAgentOrchestrationError({
      operation: 'ensureChatThread',
      message: 'Mail collaboration chat was not created.',
    })
  }
  return thread
})

/** Calls the parent AgentDO through native RPC; browser cookies are not involved. */
const bindMailRuntimeContext = Effect.fn('MailAgent.bindRuntimeContext')(
  function* (
    env: Pick<AppEnv, 'AgentDO'>,
    hostName: string,
    threadId: string,
    context: typeof MailAgentConversationContext.Type,
  ) {
    yield* Effect.tryPromise({
      try: async () => {
        const stub = await getAgentByName(env.AgentDO, hostName, {
          routingRetry: AGENT_ROUTING_RETRY,
        })
        return disposeRpcResult(
          await stub.setThreadMailConversationContext(threadId, context),
        )
      },
      catch: (cause) =>
        new MailAgentOrchestrationError({
          operation: 'bindRuntimeContext.rpc',
          message: 'Garden could not bind mail context to the agent runtime.',
          cause,
        }),
    })
  },
)

/** Authenticated server seam consumed by the Inbox agent panel. */
export const getOrCreateMailAgentChatSession = Effect.fn(
  'MailAgent.getOrCreateChatSession',
)(function* (
  db: Db,
  env: Pick<AppEnv, 'AgentDO'>,
  input: MailAgentChatSessionInput,
) {
  const authority = yield* resolveMailAgentAuthority(db, input)
  const thread = yield* ensureMailChatThread(db, input, authority)
  const context = MailAgentConversationContext.make({
    workspaceId: input.workspaceId,
    mailboxId: MailboxId.make(authority.mailboxId),
    conversationId: input.conversationId,
  })
  yield* bindMailRuntimeContext(
    env,
    authority.hostName,
    thread.runtimeKey,
    context,
  )
  return {
    ...toChatThread(thread, authority.hostName),
    status: 'idle',
    unread: false,
    conversationId: input.conversationId,
    mailboxId: authority.mailboxId,
  } satisfies MailAgentChatSession
})
