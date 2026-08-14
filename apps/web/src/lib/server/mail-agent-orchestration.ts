import { getAgentByName } from 'agents'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import {
  AgentId,
  ConversationId,
  EmailAddress,
  type EditableRecipient,
  MailboxId,
  MemberId,
  NonNegativeInt,
  UserId,
  WorkspaceId,
} from '@garden/core/mail'
import {
  MailAgentApplication,
  MailAgentDeliveryDispatcher,
  MailAgentPrincipal,
  mailDraftApplicationLayer,
  makeMailAgentApplicationLayer,
  makeMailRepositoryLayer,
  type DraftSnapshot,
  type RepositoryMessage,
} from '@garden/server/mail'
import {
  MailAgentConversationContext,
  type MailAgentDraftToolCallContext,
  type MailAgentContextToken,
} from '@garden/agent-runtime'
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
  ownerUserId: UserId,
  memberId: MemberId,
  conversationId: Schema.NullOr(ConversationId),
  agentId: AgentId,
})
export interface MailAgentChatSessionInput extends Schema.Schema.Type<
  typeof MailAgentChatSessionInput
> {}

type ResolvedMailAgentAuthority = {
  readonly agentId: string
  readonly hostName: string
  readonly mailboxIds: ReadonlyArray<string>
  readonly writableMailboxIds: ReadonlyArray<string>
  readonly selectedMailboxId: string | null
  readonly needsHostName: boolean
}

export type MailAgentChatSession = AgentChatSession
export type MailAgentTurnContextBinding = MailAgentContextToken

export const AgentMailDraftProposal = Schema.Struct({
  mode: Schema.Literals(['new', 'reply', 'reply-all', 'forward']),
  to: Schema.optionalKey(Schema.String),
  cc: Schema.optionalKey(Schema.String),
  bcc: Schema.optionalKey(Schema.String),
  subject: Schema.optionalKey(Schema.String),
  body: Schema.String,
})
export interface AgentMailDraftProposal extends Schema.Schema.Type<
  typeof AgentMailDraftProposal
> {}

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
 * Produces RFC 4122 UUIDv5 so one member/agent inbox always resolves to
 * one hidden chat row without a second mapping table. Web Crypto SHA-1 is used
 * only for UUID identity, never for security or content integrity.
 */
const mailChatThreadId = Effect.fn('MailAgent.chatThreadId')(function* (
  input: MailAgentChatSessionInput,
) {
  const namespace = uuidBytes(MAIL_CHAT_UUID_NAMESPACE)
  const name = new TextEncoder().encode(
    `${input.workspaceId}:${input.ownerUserId}:${input.agentId}:mail-inbox`,
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

/** Resolves the effective member∩agent mailbox authority for this request. */
const resolveMailAgentAuthority = Effect.fn('MailAgent.resolveAuthority')(
  function* (db: Db, input: MailAgentChatSessionInput) {
    const resolved = yield* Effect.tryPromise({
      try: async () => {
        const [memberRows, agentRows, memberAccess, agentAccess] =
          await Promise.all([
            db
              .select({ id: schema.member.id })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.id, input.memberId),
                  eq(schema.member.organizationId, input.workspaceId),
                  eq(schema.member.userId, input.ownerUserId),
                ),
              )
              .limit(1),
            db
              .select({ id: schema.agent.id, hostName: schema.agent.hostName })
              .from(schema.agent)
              .where(
                and(
                  eq(schema.agent.id, input.agentId),
                  eq(schema.agent.workspaceId, input.workspaceId),
                  eq(schema.agent.status, 'active'),
                ),
              )
              .limit(1),
            db
              .select({
                mailboxId: schema.mailMailboxAccess.mailboxId,
                accessLevel: schema.mailMailboxAccess.accessLevel,
              })
              .from(schema.mailMailboxAccess)
              .where(
                and(
                  eq(schema.mailMailboxAccess.workspaceId, input.workspaceId),
                  eq(schema.mailMailboxAccess.actorType, 'member'),
                  eq(schema.mailMailboxAccess.memberId, input.memberId),
                ),
              ),
            db
              .select({
                mailboxId: schema.mailMailboxAccess.mailboxId,
                accessLevel: schema.mailMailboxAccess.accessLevel,
              })
              .from(schema.mailMailboxAccess)
              .where(
                and(
                  eq(schema.mailMailboxAccess.workspaceId, input.workspaceId),
                  eq(schema.mailMailboxAccess.actorType, 'agent'),
                  eq(schema.mailMailboxAccess.agentId, input.agentId),
                ),
              ),
          ])
        const memberMailboxIds = new Set(
          memberAccess.map((access) => access.mailboxId),
        )
        const writableMemberMailboxIds = new Set(
          memberAccess
            .filter((access) => access.accessLevel !== 'viewer')
            .map((access) => access.mailboxId),
        )
        const mailboxIds = agentAccess
          .map((access) => access.mailboxId)
          .filter((mailboxId) => memberMailboxIds.has(mailboxId))
        const writableMailboxIds = agentAccess
          .filter((access) => access.accessLevel !== 'viewer')
          .map((access) => access.mailboxId)
          .filter((mailboxId) => writableMemberMailboxIds.has(mailboxId))
        const selectedConversation =
          input.conversationId === null
            ? null
            : (
                await db
                  .select({ mailboxId: schema.mailConversation.mailboxId })
                  .from(schema.mailConversation)
                  .where(
                    and(
                      eq(schema.mailConversation.id, input.conversationId),
                      eq(
                        schema.mailConversation.workspaceId,
                        input.workspaceId,
                      ),
                    ),
                  )
                  .limit(1)
              )[0]
        return {
          agent: agentRows[0] ?? null,
          member: memberRows[0] ?? null,
          mailboxIds,
          writableMailboxIds,
          selectedMailboxId: selectedConversation?.mailboxId ?? null,
        }
      },
      catch: (cause) =>
        new MailAgentOrchestrationError({
          operation: 'resolveAuthority.select',
          message: 'Garden could not resolve the mailbox agent.',
          cause,
        }),
    })
    if (
      !resolved.agent ||
      !resolved.member ||
      resolved.mailboxIds.length === 0 ||
      (input.conversationId !== null &&
        (resolved.selectedMailboxId === null ||
          !resolved.mailboxIds.includes(resolved.selectedMailboxId)))
    ) {
      return yield* new MailAgentOrchestrationError({
        operation: 'resolveAuthority',
        message: 'Mailbox agent access was not found.',
      })
    }
    return {
      agentId: resolved.agent.id,
      hostName: resolved.agent.hostName ?? resolved.agent.id,
      mailboxIds: resolved.mailboxIds,
      writableMailboxIds: resolved.writableMailboxIds,
      selectedMailboxId: resolved.selectedMailboxId,
      needsHostName: resolved.agent.hostName === null,
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
        const runtimeKey = crypto.randomUUID()
        await tx
          .insert(schema.chatThread)
          .values({
            id: threadId,
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId,
            agentId: input.agentId,
            runtimeKind: 'chat',
            runtimeKey,
            title: 'Inbox agent',
            lastMessage: '',
            archivedAt: new Date(0),
          })
          .onConflictDoNothing({ target: schema.chatThread.id })
        await tx
          .update(schema.chatThread)
          .set({ runtimeKey })
          .where(
            and(
              eq(schema.chatThread.id, threadId),
              eq(schema.chatThread.workspaceId, input.workspaceId),
              eq(schema.chatThread.ownerUserId, input.ownerUserId),
              eq(schema.chatThread.agentId, input.agentId),
              eq(schema.chatThread.runtimeKey, threadId),
              eq(schema.chatThread.title, 'Inbox agent'),
            ),
          )
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

/**
 * Requires the already-open hidden inbox session bound to this authenticated
 * owner and agent. Draft persistence cannot mint or adopt a different chat
 * identity from a browser-supplied mail payload.
 */
const requireMailChatThread = Effect.fn('MailAgent.requireChatThread')(
  function* (db: Db, input: MailAgentChatSessionInput) {
    const threadId = yield* mailChatThreadId(input)
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ runtimeKey: schema.chatThread.runtimeKey })
          .from(schema.chatThread)
          .where(
            and(
              eq(schema.chatThread.id, threadId),
              eq(schema.chatThread.workspaceId, input.workspaceId),
              eq(schema.chatThread.ownerUserId, input.ownerUserId),
              eq(schema.chatThread.agentId, input.agentId),
              eq(schema.chatThread.runtimeKind, 'chat'),
              eq(schema.chatThread.title, 'Inbox agent'),
            ),
          )
          .limit(1),
      catch: (cause) =>
        new MailAgentOrchestrationError({
          operation: 'requireChatThread.select',
          message: 'Garden could not validate the mail collaboration chat.',
          cause,
        }),
    })
    if (rows[0] === undefined) {
      return yield* new MailAgentOrchestrationError({
        operation: 'requireChatThread',
        message: 'Open the mailbox agent before creating a draft.',
      })
    }
    return rows[0]
  },
)

/** Splits and normalizes one model-proposed address field at the server seam. */
const proposedAddresses = Effect.fn('MailAgent.proposedAddresses')(function* (
  value: string | undefined,
) {
  const candidates = [
    ...new Set(
      (value ?? '')
        .split(/[;,]/)
        .map((address) => address.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  return yield* Effect.forEach(candidates, (address) =>
    Schema.decodeUnknownEffect(EmailAddress)(address).pipe(
      Effect.mapError(
        (cause) =>
          new MailAgentOrchestrationError({
            operation: 'createDraft.decodeRecipient',
            message: `Invalid email recipient: ${address}`,
            cause,
          }),
      ),
    ),
  )
})

/** Derives canonical reply recipients from the open message when omitted. */
const replyAddresses = (
  message: RepositoryMessage,
  mode: AgentMailDraftProposal['mode'],
  ownAddresses: ReadonlySet<string>,
): {
  readonly to: ReadonlyArray<string>
  readonly cc: ReadonlyArray<string>
} => {
  if (mode === 'forward' || mode === 'new') return { to: [], cc: [] }
  const replyTarget = message.replyTo[0]?.address ?? message.senderAddress
  if (mode === 'reply') return { to: [replyTarget], cc: [] }
  const all = [
    replyTarget,
    ...message.recipients.map((recipient) => recipient.address),
  ].filter((address) => !ownAddresses.has(address))
  return { to: [...new Set(all)], cc: [] }
}

/** Adds conventional reply/forward prefixes without duplicating them. */
const proposedSubject = (
  proposal: AgentMailDraftProposal,
  conversationSubject: string,
) => {
  const explicit = proposal.subject?.trim()
  if (explicit) return explicit
  if (proposal.mode === 'new') return ''
  const prefix = proposal.mode === 'forward' ? 'Fwd:' : 'Re:'
  const existing = proposal.mode === 'forward' ? /^fwd:/i : /^re:/i
  return existing.test(conversationSubject)
    ? conversationSubject
    : `${prefix} ${conversationSubject}`
}

/** Converts grouped addresses into one position-stable repository contract. */
const editableRecipients = (
  to: ReadonlyArray<typeof EmailAddress.Type>,
  cc: ReadonlyArray<typeof EmailAddress.Type>,
  bcc: ReadonlyArray<typeof EmailAddress.Type>,
): ReadonlyArray<EditableRecipient> =>
  [
    ...to.map((address) => ({ kind: 'to' as const, address })),
    ...cc.map((address) => ({ kind: 'cc' as const, address })),
    ...bcc.map((address) => ({ kind: 'bcc' as const, address })),
  ].map((recipient, position) => ({
    ...recipient,
    position: NonNegativeInt.make(position),
    displayName: null,
  }))

/** Calls the parent AgentDO through native RPC; browser cookies are not involved. */
const issueMailRuntimeContextToken = Effect.fn('MailAgent.issueContextToken')(
  function* (
    env: Pick<AppEnv, 'AgentDO'>,
    hostName: string,
    threadId: string,
    context: typeof MailAgentConversationContext.Type,
  ) {
    return yield* Effect.tryPromise({
      try: async () => {
        const stub = await getAgentByName(env.AgentDO, hostName, {
          routingRetry: AGENT_ROUTING_RETRY,
        })
        return disposeRpcResult(
          await stub.issueThreadMailContextToken(threadId, context),
        )
      },
      catch: (cause) =>
        new MailAgentOrchestrationError({
          operation: 'issueContextToken.rpc',
          message: 'Garden could not authorize mail context for this turn.',
          cause,
        }),
    })
  },
)

/** Loads and consumes the exact server-observed client-tool proposal. */
const consumeMailRuntimeDraftToolCall = Effect.fn(
  'MailAgent.consumeDraftToolCallRpc',
)(function* (
  env: Pick<AppEnv, 'AgentDO'>,
  hostName: string,
  threadId: string,
  toolCallId: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const stub = await getAgentByName(env.AgentDO, hostName, {
        routingRetry: AGENT_ROUTING_RETRY,
      })
      return disposeRpcResult(
        await stub.consumeThreadMailDraftToolCall(threadId, toolCallId),
      ) as MailAgentDraftToolCallContext
    },
    catch: (cause) =>
      new MailAgentOrchestrationError({
        operation: 'consumeDraftToolCall.rpc',
        message: 'Garden could not load the active agent draft action.',
        cause,
      }),
  })
})

/** Authenticated server seam consumed by the Inbox agent panel. */
export const getOrCreateMailAgentChatSession = Effect.fn(
  'MailAgent.getOrCreateChatSession',
)(function* (db: Db, input: MailAgentChatSessionInput) {
  const authority = yield* resolveMailAgentAuthority(db, input)
  const thread = yield* ensureMailChatThread(db, input, authority)
  return {
    ...toChatThread(thread, authority.hostName),
    status: 'idle',
    unread: false,
  } satisfies MailAgentChatSession
})

/**
 * Resolves immutable context from proof minted during the actual compose_mail
 * call, then revalidates current member∩agent authority before persistence.
 */
export const consumeMailAgentDraftToolCall = Effect.fn(
  'MailAgent.consumeDraftToolCall',
)(function* (
  db: Db,
  env: Pick<AppEnv, 'AgentDO'>,
  input: MailAgentChatSessionInput,
  toolCallId: string,
) {
  const authority = yield* resolveMailAgentAuthority(db, input)
  const thread = yield* requireMailChatThread(db, input)
  const toolCall = yield* consumeMailRuntimeDraftToolCall(
    env,
    authority.hostName,
    thread.runtimeKey,
    toolCallId,
  )
  const proposal = yield* Schema.decodeUnknownEffect(AgentMailDraftProposal)(
    toolCall.proposal,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailAgentOrchestrationError({
          operation: 'consumeDraftToolCall.decodeProposal',
          message: 'Agent draft proposal was invalid.',
          cause,
        }),
    ),
  )
  if (
    toolCall.workspaceId !== input.workspaceId ||
    toolCall.ownerUserId !== input.ownerUserId ||
    toolCall.memberId !== input.memberId
  ) {
    return yield* new MailAgentOrchestrationError({
      operation: 'consumeDraftToolCall.identity',
      message: 'Agent draft tool call does not belong to this member.',
    })
  }
  const immutableInput: MailAgentChatSessionInput = {
    ...input,
    conversationId:
      toolCall.conversationId === null
        ? null
        : yield* Schema.decodeUnknownEffect(ConversationId)(
            toolCall.conversationId,
          ),
  }
  const refreshed = yield* resolveMailAgentAuthority(db, immutableInput)
  if (
    toolCall.mailboxId !== null &&
    refreshed.selectedMailboxId !== toolCall.mailboxId
  ) {
    return yield* new MailAgentOrchestrationError({
      operation: 'consumeDraftToolCall.mailbox',
      message: 'Agent draft mailbox access changed before persistence.',
    })
  }
  return { input: immutableInput, proposal }
})

/**
 * Persists the proposal as an agent-authored canonical draft after proving the
 * current member owns the stable hidden session and both actors can write the
 * selected mailbox. Sender selection remains inside MailAgentApplication.
 */
export const createAgentMailDraft = Effect.fn('MailAgent.createDraft')(
  function* (
    db: Db,
    input: MailAgentChatSessionInput,
    proposal: AgentMailDraftProposal,
  ) {
    const authority = yield* resolveMailAgentAuthority(db, input)
    yield* requireMailChatThread(db, input)

    const principal = MailAgentPrincipal.make({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      sendExternal: 'manual',
    })
    const repositoryLayer = makeMailRepositoryLayer(db)
    const draftApplicationLayer = mailDraftApplicationLayer.pipe(
      Layer.provide(repositoryLayer),
    )
    const dispatcherLayer = Layer.succeed(
      MailAgentDeliveryDispatcher,
      MailAgentDeliveryDispatcher.of({
        dispatch: () => Effect.die('Draft creation cannot dispatch delivery.'),
      }),
    )
    const applicationLayer = makeMailAgentApplicationLayer(principal).pipe(
      Layer.provide(
        Layer.mergeAll(repositoryLayer, draftApplicationLayer, dispatcherLayer),
      ),
    )

    return yield* Effect.gen(function* () {
      const application = yield* MailAgentApplication
      const mailboxes = yield* application.listMailboxes()
      const mailbox =
        input.conversationId === null
          ? mailboxes.find(
              (candidate) =>
                authority.writableMailboxIds.includes(candidate.id) &&
                candidate.sendCapability !== 'read_only',
            )
          : mailboxes.find(
              (candidate) =>
                candidate.id === authority.selectedMailboxId &&
                authority.writableMailboxIds.includes(candidate.id) &&
                candidate.sendCapability !== 'read_only',
            )
      if (mailbox === undefined) {
        return yield* new MailAgentOrchestrationError({
          operation: 'createDraft.resolveMailbox',
          message: 'No jointly writable mailbox sender is available.',
        })
      }

      const threaded = proposal.mode !== 'new'
      if (threaded && input.conversationId === null) {
        return yield* new MailAgentOrchestrationError({
          operation: 'createDraft.resolveConversation',
          message: 'Open an email before drafting a reply or forward.',
        })
      }
      const detail =
        input.conversationId === null
          ? null
          : yield* application.readConversation({
              conversationId: input.conversationId,
            })
      const source = threaded ? detail?.messages.at(-1) : undefined
      if (threaded && source === undefined) {
        return yield* new MailAgentOrchestrationError({
          operation: 'createDraft.resolveMessage',
          message: 'The open conversation has no message to draft from.',
        })
      }

      const ownAddresses = new Set(
        mailboxes.flatMap((candidate) =>
          [candidate.primaryAddress, candidate.externalAddress].filter(
            (address): address is typeof EmailAddress.Type => address !== null,
          ),
        ),
      )
      const derived =
        source === undefined
          ? { to: [], cc: [] }
          : replyAddresses(source, proposal.mode, ownAddresses)
      const proposedTo = yield* proposedAddresses(proposal.to)
      const proposedCc = yield* proposedAddresses(proposal.cc)
      const proposedBcc = yield* proposedAddresses(proposal.bcc)
      const to =
        proposedTo.length > 0
          ? proposedTo
          : yield* Effect.forEach(derived.to, (address) =>
              Schema.decodeUnknownEffect(EmailAddress)(address),
            )
      const cc =
        proposedCc.length > 0
          ? proposedCc
          : yield* Effect.forEach(derived.cc, (address) =>
              Schema.decodeUnknownEffect(EmailAddress)(address),
            )
      if (to.length === 0) {
        return yield* new MailAgentOrchestrationError({
          operation: 'createDraft.resolveRecipients',
          message: 'At least one To recipient is required.',
        })
      }

      const draft: DraftSnapshot = yield* application.createDraft({
        mailboxId: MailboxId.make(mailbox.id),
        conversationId: threaded ? input.conversationId : null,
        replyToMessageId:
          proposal.mode === 'reply' || proposal.mode === 'reply-all'
            ? (source?.id ?? null)
            : null,
        subject: proposedSubject(proposal, detail?.conversation.subject ?? ''),
        textBody: proposal.body || null,
        htmlBody: null,
        recipients: editableRecipients(to, cc, proposedBcc),
        attachments: [],
      })
      return draft
    }).pipe(Effect.provide(applicationLayer))
  },
)

/** Issues one server-authorized context capability for an imminent mail turn. */
export const bindMailAgentTurnContext = Effect.fn('MailAgent.bindTurnContext')(
  function* (
    db: Db,
    env: Pick<AppEnv, 'AgentDO'>,
    input: MailAgentChatSessionInput,
  ) {
    const authority = yield* resolveMailAgentAuthority(db, input)
    const thread = yield* ensureMailChatThread(db, input, authority)
    let context: typeof MailAgentConversationContext.Type
    if (input.conversationId === null) {
      context = MailAgentConversationContext.cases.Inbox.make({
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        memberId: input.memberId,
      })
    } else {
      if (authority.selectedMailboxId === null) {
        return yield* new MailAgentOrchestrationError({
          operation: 'bindTurnContext',
          message: 'Selected conversation mailbox was not authorized.',
        })
      }
      context = MailAgentConversationContext.cases.Conversation.make({
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        memberId: input.memberId,
        mailboxId: MailboxId.make(authority.selectedMailboxId),
        conversationId: input.conversationId,
      })
    }
    return yield* issueMailRuntimeContextToken(
      env,
      authority.hostName,
      thread.runtimeKey,
      context,
    )
  },
)
