import {
  AgentId,
  AttachmentId,
  ConversationId,
  CreateDraftInput,
  DraftId,
  EditableAttachment,
  EmailAddress,
  MailActor,
  MailAddressId,
  MailboxId,
  MailSyncAccountId,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  SaveDraftInput,
  UpdateConversationStateInput,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import type { GardenDatabase } from '@garden/db'
import {
  agent,
  mailAddress,
  mailConversation,
  mailMailboxAccess,
  mailSyncAccount,
} from '@garden/db/schema'
import {
  deleteUnreferencedDraftAttachment,
  DraftAttachmentUploadInput,
  authorizeDraftAttachmentUpload,
  MailRepository,
  MailDraftApplication,
  mailDraftApplicationLayer,
  makeR2MailObjectStoreLayer,
  makeMailRepositoryLayer,
  storeDraftAttachment,
  gmailLabelMutation,
  type AccessibleMailbox,
  type AssignmentSnapshot,
  type ConversationActorState,
  type ConversationDetail,
  type ConversationPage,
  type DraftSnapshot,
  type MemberDraftCommandInput,
} from '@garden/server/mail'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import type { AppRequestContext } from './context'
import {
  MailRequestBoundaryError,
  MailRequestForbiddenError,
  requireMailMemberAuthority,
} from './mail-authority'
import type { MailDeliveryWorkflowParams } from './mail-delivery-workflow'
import type {
  AgentMailDraftProposal,
  MailAgentChatSession,
  MailAgentChatSessionInput,
  MailAgentTurnContextBinding,
} from './mail-agent-orchestration'
import {
  gmailPersonalConnectionRef,
  withExecutorGmailClient,
} from './executor-engine/gmail-mail-import-plugin'
import { executorProgram } from './executor-runtime'

/** Workflow dispatch failed after draft authorization was durably recorded. */
export class MailDeliveryDispatchError extends Schema.TaggedErrorClass<MailDeliveryDispatchError>()(
  'MailDeliveryDispatchError',
  {
    workflowInstanceId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Draft cannot be created from the selected accessible mailbox. */
export class MailDraftSetupError extends Schema.TaggedErrorClass<MailDraftSetupError>()(
  'MailDraftSetupError',
  {
    mailboxId: MailboxId,
    message: Schema.String,
  },
) {}

export type MailDraftValuesInput = {
  workspaceId: string
  mailboxId: string
  conversationId: string | null
  replyToMessageId: string | null
  draftId: string | null
  expectedRevision: number | null
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  htmlBody: string | null
  attachments: Array<{
    attachmentId: string
    disposition: 'attachment' | 'inline'
    contentId: string | null
    position: number
  }>
}

export type MailDraftAttachmentUploadInput = {
  workspaceId: string
  mailboxId: string
  fileName: string
  contentType: string
  content: Uint8Array
}

export type MailAgentDraftValuesInput = {
  workspaceId: string
  agentId: string
  draftCapability: string
  mode: AgentMailDraftProposal['mode']
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  body: string
}

/** Exact persisted revision exposed to the composer without sender transport ids. */
export type MailAgentComposerDraft = Omit<DraftSnapshot, 'sender'>

export type MailConversationStateAction =
  | 'mark-read'
  | 'mark-unread'
  | 'archive'
  | 'unarchive'
  | 'pin'
  | 'unpin'

/**
 * Mirrors state changes for imported Gmail threads before updating Garden's
 * local projection. Hosted mailboxes have no sync account and pass through.
 * Gmail label mutation is idempotent, so retrying a failed request is safe.
 */
const writeGmailConversationState = Effect.fn(
  'GardenMail.writeGmailConversationState',
)(function* (input: {
  db: GardenDatabase
  workspaceId: typeof WorkspaceId.Type
  userId: string
  conversationId: typeof ConversationId.Type
  action: MailConversationStateAction
}) {
  const rows = yield* Effect.tryPromise({
    try: () =>
      input.db
        .select({
          syncAccountId: mailSyncAccount.id,
          ownerUserId: mailSyncAccount.userId,
          provider: mailSyncAccount.provider,
          executorConnectionName: mailSyncAccount.executorConnectionName,
          threadKey: mailConversation.threadKey,
        })
        .from(mailConversation)
        .innerJoin(
          mailSyncAccount,
          and(
            eq(mailSyncAccount.workspaceId, mailConversation.workspaceId),
            eq(mailSyncAccount.mailboxId, mailConversation.mailboxId),
          ),
        )
        .where(
          and(
            eq(mailConversation.workspaceId, input.workspaceId),
            eq(mailConversation.id, input.conversationId),
          ),
        )
        .limit(1),
    catch: (cause) =>
      new MailRequestBoundaryError({
        operation: 'gmail.state.resolve',
        message: 'Garden could not resolve the Gmail thread.',
        cause,
      }),
  })
  const account = rows[0]
  if (account === undefined) return
  if (account.provider !== 'gmail' || account.ownerUserId !== input.userId) {
    return yield* new MailRequestForbiddenError({
      workspaceId: input.workspaceId,
      message:
        'Only the connected Gmail account owner can change provider state.',
    })
  }
  const prefix = `gmail:${account.syncAccountId}:`
  if (!account.threadKey.startsWith(prefix)) {
    return yield* new MailRequestBoundaryError({
      operation: 'gmail.state.thread',
      message: 'Garden could not resolve the Gmail provider thread.',
    })
  }
  const threadId = account.threadKey.slice(prefix.length)
  const labels = gmailLabelMutation(input.action)
  yield* executorProgram(
    { tenant: input.workspaceId, subject: input.userId },
    (executor) =>
      withExecutorGmailClient(
        executor.gmailMailImport,
        gmailPersonalConnectionRef(account.executorConnectionName),
        (gmail) => gmail.modifyThread({ threadId, ...labels }),
      ),
  )
})

export type MailInboxSnapshot = {
  mailboxes: ReadonlyArray<AccessibleMailbox>
  page: ConversationPage
}

export type EligibleMailAgent = {
  id: string
  name: string
}

/** Decodes raw server-function ids into the canonical Effect mail contracts. */
const decodeWorkspaceId = (workspaceId: string) =>
  Schema.decodeUnknownEffect(WorkspaceId)(workspaceId)

/** Runs a repository program with request-derived member identity. */
const withMemberRepository = <A, E>(
  context: AppRequestContext,
  workspaceId: string,
  program: (input: {
    workspaceId: typeof WorkspaceId.Type
    actor: typeof MailActor.Type
    userId: string
    db: GardenDatabase
  }) => Effect.Effect<A, E, MailRepository>,
) =>
  Effect.gen(function* () {
    const canonicalWorkspaceId = yield* decodeWorkspaceId(workspaceId)
    const authority = yield* requireMailMemberAuthority(
      context,
      canonicalWorkspaceId,
    )
    return yield* program({
      workspaceId: canonicalWorkspaceId,
      actor: authority.actor,
      userId: authority.userId,
      db: authority.db,
    }).pipe(Effect.provide(makeMailRepositoryLayer(authority.db)))
  })

/** Lists actor-visible mailboxes and their conversations in one request. */
export async function getMailInboxSnapshot(
  context: AppRequestContext,
  input: {
    workspaceId: string
    cursor: { activityAt: string; conversationId: string } | null
    query: string
    unreadOnly: boolean
    limit: number
  },
): Promise<MailInboxSnapshot> {
  return await Effect.runPromise(
    withMemberRepository(context, input.workspaceId, ({ workspaceId, actor }) =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const mailboxes =
          input.cursor === null
            ? yield* repository.listMailboxes({ workspaceId, actor })
            : []
        const cursor =
          input.cursor === null
            ? null
            : {
                activityAt: yield* Schema.decodeUnknownEffect(UtcTimestamp)(
                  input.cursor.activityAt,
                ),
                conversationId: yield* Schema.decodeUnknownEffect(
                  ConversationId,
                )(input.cursor.conversationId),
              }
        const page = yield* repository.listConversationPage({
          workspaceId,
          actor,
          mailboxId: null,
          cursor,
          query: input.query,
          unreadOnly: input.unreadOnly,
          limit: yield* Schema.decodeUnknownEffect(PositiveInt)(input.limit),
        })
        return { mailboxes, page }
      }),
    ),
  )
}

/** Loads one conversation only after repository projection authorization. */
export async function getMailConversation(
  context: AppRequestContext,
  input: { workspaceId: string; conversationId: string },
): Promise<ConversationDetail> {
  return await Effect.runPromise(
    withMemberRepository(context, input.workspaceId, ({ workspaceId, actor }) =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const conversationId = yield* Schema.decodeUnknownEffect(
          ConversationId,
        )(input.conversationId)
        return yield* repository.getConversation({
          workspaceId,
          actor,
          conversationId,
        })
      }),
    ),
  )
}

/** Lists active agents already granted access to the selected mailbox. */
export async function getEligibleMailAgents(
  context: AppRequestContext,
  input: { workspaceId: string; conversationId: string },
): Promise<ReadonlyArray<EligibleMailAgent>> {
  return await Effect.runPromise(
    withMemberRepository(
      context,
      input.workspaceId,
      ({ workspaceId, actor, db }) =>
        Effect.gen(function* () {
          const repository = yield* MailRepository
          const conversationId = yield* Schema.decodeUnknownEffect(
            ConversationId,
          )(input.conversationId)
          const detail = yield* repository.getConversation({
            workspaceId,
            actor,
            conversationId,
          })
          return yield* Effect.tryPromise(() =>
            db
              .select({ id: agent.id, name: agent.name })
              .from(mailMailboxAccess)
              .innerJoin(agent, eq(agent.id, mailMailboxAccess.agentId))
              .where(
                and(
                  eq(mailMailboxAccess.workspaceId, workspaceId),
                  eq(
                    mailMailboxAccess.mailboxId,
                    detail.conversation.mailboxId,
                  ),
                  eq(mailMailboxAccess.actorType, 'agent'),
                  eq(agent.workspaceId, workspaceId),
                  eq(agent.status, 'active'),
                ),
              ),
          )
        }),
    ),
  )
}

/** Proves member visibility before authority crosses into the agent runtime. */
const authorizeMailAgentSession = Effect.fn('GardenMail.authorizeAgentSession')(
  function* (
    context: AppRequestContext,
    input: {
      workspaceId: string
      conversationId: string | null
      agentId: string
    },
  ) {
    const workspaceId = yield* decodeWorkspaceId(input.workspaceId)
    const authority = yield* requireMailMemberAuthority(context, workspaceId)
    const conversationId =
      input.conversationId === null
        ? null
        : yield* Schema.decodeUnknownEffect(ConversationId)(
            input.conversationId,
          )
    if (conversationId !== null) {
      yield* Effect.gen(function* () {
        const repository = yield* MailRepository
        yield* repository.getConversation({
          workspaceId,
          actor: authority.actor,
          conversationId,
        })
      }).pipe(Effect.provide(makeMailRepositoryLayer(authority.db)))
    }
    return {
      db: authority.db,
      input: {
        workspaceId,
        ownerUserId: authority.userId,
        memberId: authority.actor.memberId,
        conversationId,
        agentId: yield* Schema.decodeUnknownEffect(AgentId)(input.agentId),
      } satisfies MailAgentChatSessionInput,
    }
  },
)

type MailAgentRequestInput = {
  workspaceId: string
  conversationId: string | null
  agentId: string
}

/** Returns the stable chat identity without mutating selected-email context. */
export async function getMailAgentSession(
  context: AppRequestContext,
  input: MailAgentRequestInput,
): Promise<MailAgentChatSession> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const authorized = yield* authorizeMailAgentSession(context, input)
      // Keep AgentDO runtime imports outside client-side Vitest module loading;
      // TanStack executes this branch only inside the authenticated Worker.
      const orchestration = yield* Effect.promise(
        () => import('./mail-agent-orchestration'),
      )
      return yield* orchestration.getOrCreateMailAgentChatSession(
        authorized.db,
        authorized.input,
      )
    }),
  )
}

/** Issues a per-turn capability after refreshing member and agent authority. */
export async function bindMailAgentTurnContext(
  context: AppRequestContext,
  input: MailAgentRequestInput,
): Promise<MailAgentTurnContextBinding> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const authorized = yield* authorizeMailAgentSession(context, input)
      const orchestration = yield* Effect.promise(
        () => import('./mail-agent-orchestration'),
      )
      return yield* orchestration.bindMailAgentTurnContext(
        authorized.db,
        context.env,
        authorized.input,
      )
    }),
  )
}

/**
 * Persists a browser compose handoff as the authenticated session's agent.
 * The request carries no actor, member, mailbox, sender, or revision identity;
 * those are resolved from the stable hidden inbox session and Postgres access.
 */
export async function persistAgentMailDraft(
  context: AppRequestContext,
  input: MailAgentDraftValuesInput,
): Promise<MailAgentComposerDraft> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const authorized = yield* authorizeMailAgentSession(context, {
        workspaceId: input.workspaceId,
        conversationId: null,
        agentId: input.agentId,
      })
      const orchestration = yield* Effect.promise(
        () => import('./mail-agent-orchestration'),
      )
      const proposal = yield* Schema.decodeUnknownEffect(
        orchestration.AgentMailDraftProposal,
      )({
        mode: input.mode,
        ...(input.to === undefined ? {} : { to: input.to }),
        ...(input.cc === undefined ? {} : { cc: input.cc }),
        ...(input.bcc === undefined ? {} : { bcc: input.bcc }),
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        body: input.body,
      })
      const immutableInput =
        yield* orchestration.consumeMailAgentDraftCapability(
          authorized.db,
          context.env,
          authorized.input,
          input.draftCapability,
          proposal,
        )
      const draft = yield* orchestration.createAgentMailDraft(
        authorized.db,
        immutableInput,
        proposal,
      )
      return {
        id: draft.id,
        mailboxId: draft.mailboxId,
        conversationId: draft.conversationId,
        author: draft.author,
        replyToMessageId: draft.replyToMessageId,
        status: draft.status,
        revision: draft.revision,
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody: draft.htmlBody,
        recipients: draft.recipients,
        attachments: draft.attachments,
        updatedAt: draft.updatedAt,
      }
    }),
  )
}

/**
 * Applies named state transitions while preserving every unrelated actor-owned
 * state field. Mark-read resolves the canonical newest message server-side, so
 * a client cannot point read state at a message outside the conversation.
 */
export async function mutateMailConversationState(
  context: AppRequestContext,
  input: {
    workspaceId: string
    conversationId: string
    action: MailConversationStateAction
  },
): Promise<ConversationActorState> {
  return await Effect.runPromise(
    withMemberRepository(
      context,
      input.workspaceId,
      ({ workspaceId, actor, userId, db }) =>
        Effect.gen(function* () {
          const repository = yield* MailRepository
          const conversationId = yield* Schema.decodeUnknownEffect(
            ConversationId,
          )(input.conversationId)
          const detail = yield* repository.getConversation({
            workspaceId,
            actor,
            conversationId,
          })
          const current = detail.conversation.state
          const now = UtcTimestamp.make(new Date().toISOString())
          const latestMessageId = detail.messages.at(-1)?.id ?? null
          const next = yield* Schema.decodeUnknownEffect(
            UpdateConversationStateInput,
          )({
            workspaceId,
            conversationId,
            actor,
            lastReadMessageId:
              input.action === 'mark-read'
                ? latestMessageId
                : input.action === 'mark-unread'
                  ? null
                  : (current?.lastReadMessageId ?? null),
            readAt:
              input.action === 'mark-read'
                ? now
                : input.action === 'mark-unread'
                  ? null
                  : (current?.readAt ?? null),
            archivedAt:
              input.action === 'archive'
                ? now
                : input.action === 'unarchive'
                  ? null
                  : (current?.archivedAt ?? null),
            mutedAt: current?.mutedAt ?? null,
            pinned:
              input.action === 'pin'
                ? true
                : input.action === 'unpin'
                  ? false
                  : (current?.pinned ?? false),
          })
          yield* writeGmailConversationState({
            db,
            workspaceId,
            userId,
            conversationId,
            action: input.action,
          })
          return yield* repository.updateConversationState(next)
        }),
    ),
  )
}

/**
 * Assigns an accessible workspace agent to a mail conversation. The member
 * identity comes from the authenticated request and the repository verifies
 * both write access to the conversation and mailbox access for the agent.
 */
export async function assignMailConversationAgent(
  context: AppRequestContext,
  input: {
    workspaceId: string
    conversationId: string
    agentId: string
  },
): Promise<AssignmentSnapshot> {
  return await Effect.runPromise(
    withMemberRepository(context, input.workspaceId, ({ workspaceId, actor }) =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const conversationId = yield* Schema.decodeUnknownEffect(
          ConversationId,
        )(input.conversationId)
        const agentId = yield* Schema.decodeUnknownEffect(AgentId)(
          input.agentId,
        )
        const assignment = yield* repository.assignConversation({
          workspaceId,
          conversationId,
          assignee: {
            _tag: 'Agent',
            agentId,
          },
          assignedBy: actor,
        })
        return assignment
      }),
    ),
  )
}

/**
 * Ends one agent assignment without deleting its audit history. Repository
 * authorization keeps callers from unassigning conversations they cannot edit.
 */
export async function unassignMailConversationAgent(
  context: AppRequestContext,
  input: {
    workspaceId: string
    conversationId: string
    agentId: string
  },
): Promise<AssignmentSnapshot> {
  return await Effect.runPromise(
    withMemberRepository(context, input.workspaceId, ({ workspaceId, actor }) =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        return yield* repository.unassignConversation({
          workspaceId,
          conversationId: yield* Schema.decodeUnknownEffect(ConversationId)(
            input.conversationId,
          ),
          assignee: {
            _tag: 'Agent',
            agentId: yield* Schema.decodeUnknownEffect(AgentId)(input.agentId),
          },
          unassignedBy: actor,
        })
      }),
    ),
  )
}

/** Converts typed recipient lists into position-stable canonical recipients. */
const draftRecipients = (values: MailDraftValuesInput) =>
  Effect.gen(function* () {
    const groups = [
      ['to', values.to] as const,
      ['cc', values.cc] as const,
      ['bcc', values.bcc] as const,
    ]
    const recipients = []
    let position = 0
    for (const [kind, addresses] of groups) {
      for (const address of addresses) {
        recipients.push({
          kind,
          position: NonNegativeInt.make(position),
          displayName: null,
          address: yield* Schema.decodeUnknownEffect(EmailAddress)(address),
        })
        position += 1
      }
    }
    return recipients
  })

/** Decodes attachment handles; storage keys never enter this contract. */
const draftAttachments = (values: MailDraftValuesInput) =>
  Effect.forEach(values.attachments, (attachment) =>
    Schema.decodeUnknownEffect(EditableAttachment)(attachment),
  )

/**
 * Stores one member upload after proving writable mailbox access. R2 and DB
 * operations remain in the Effect application seam; this Promise is only the
 * TanStack server-function boundary.
 */
export async function uploadMailDraftAttachment(
  context: AppRequestContext,
  values: MailDraftAttachmentUploadInput,
) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(
        DraftAttachmentUploadInput,
      )(values)
      const authority = yield* requireMailMemberAuthority(
        context,
        input.workspaceId,
      )
      const repositoryLayer = makeMailRepositoryLayer(authority.db)
      const mailboxes = yield* Effect.gen(function* () {
        const repository = yield* MailRepository
        return yield* repository.listMailboxes({
          workspaceId: input.workspaceId,
          actor: authority.actor,
        })
      }).pipe(Effect.provide(repositoryLayer))
      yield* authorizeDraftAttachmentUpload(mailboxes, input.mailboxId)
      return yield* storeDraftAttachment(authority.db, input).pipe(
        Effect.provide(makeR2MailObjectStoreLayer(context.env.FILES)),
      )
    }),
  )
}

/** Deletes an abandoned, unreferenced upload inside the member workspace. */
export async function deleteMailDraftAttachment(
  context: AppRequestContext,
  values: { workspaceId: string; mailboxId: string; attachmentId: string },
): Promise<boolean> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceId = yield* decodeWorkspaceId(values.workspaceId)
      const attachmentId = yield* Schema.decodeUnknownEffect(AttachmentId)(
        values.attachmentId,
      )
      const authority = yield* requireMailMemberAuthority(context, workspaceId)
      return yield* deleteUnreferencedDraftAttachment(authority.db, {
        workspaceId,
        mailboxId: yield* Schema.decodeUnknownEffect(MailboxId)(
          values.mailboxId,
        ),
        attachmentId,
      }).pipe(Effect.provide(makeR2MailObjectStoreLayer(context.env.FILES)))
    }),
  )
}

/** Creates a new draft or saves the caller-owned optimistic revision. */
export async function persistMailDraft(
  context: AppRequestContext,
  values: MailDraftValuesInput,
): Promise<DraftSnapshot> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceId = yield* decodeWorkspaceId(values.workspaceId)
      const authority = yield* requireMailMemberAuthority(context, workspaceId)
      const repositoryProgram = Effect.gen(function* () {
        const repository = yield* MailRepository
        const recipients = yield* draftRecipients(values)
        const attachments = yield* draftAttachments(values)
        const htmlBody = values.htmlBody
        if (values.draftId !== null) {
          const input = yield* Schema.decodeUnknownEffect(SaveDraftInput)({
            workspaceId,
            draftId: DraftId.make(values.draftId),
            actor: authority.actor,
            expectedRevision: NonNegativeInt.make(values.expectedRevision ?? 0),
            subject: values.subject,
            textBody: values.body || null,
            htmlBody,
            recipients,
            attachments,
          })
          return yield* repository.saveDraft(input)
        }

        const mailboxId = MailboxId.make(values.mailboxId)
        const accessible = yield* repository.listMailboxes({
          workspaceId,
          actor: authority.actor,
        })
        if (!accessible.some((mailbox) => mailbox.id === mailboxId)) {
          return yield* new MailDraftSetupError({
            mailboxId,
            message: 'Mailbox access denied.',
          })
        }
        const selectedMailbox = accessible.find(
          (mailbox) => mailbox.id === mailboxId,
        )
        const sender = yield* Effect.gen(function* () {
          if (selectedMailbox?.sendCapability === 'garden_transport') {
            const addressRows = yield* Effect.tryPromise(() =>
              authority.db
                .select({ id: mailAddress.id })
                .from(mailAddress)
                .where(
                  and(
                    eq(mailAddress.workspaceId, workspaceId),
                    eq(mailAddress.mailboxId, mailboxId),
                    eq(mailAddress.kind, 'primary'),
                    eq(mailAddress.status, 'active'),
                  ),
                )
                .limit(1),
            )
            const address = addressRows[0]
            if (address) {
              return {
                _tag: 'GardenAddress' as const,
                addressId: MailAddressId.make(address.id),
              }
            }
          }
          if (selectedMailbox?.sendCapability === 'gmail_transport') {
            const accountRows = yield* Effect.tryPromise(() =>
              authority.db
                .select({ id: mailSyncAccount.id })
                .from(mailSyncAccount)
                .where(
                  and(
                    eq(mailSyncAccount.workspaceId, workspaceId),
                    eq(mailSyncAccount.mailboxId, mailboxId),
                  ),
                )
                .limit(1),
            )
            const account = accountRows[0]
            if (account) {
              return {
                _tag: 'ExternalAccount' as const,
                syncAccountId: MailSyncAccountId.make(account.id),
              }
            }
          }
          return yield* new MailDraftSetupError({
            mailboxId,
            message: 'Mailbox has no active sender.',
          })
        })

        const input = yield* Schema.decodeUnknownEffect(CreateDraftInput)({
          workspaceId,
          mailboxId,
          sender,
          conversationId:
            values.conversationId === null
              ? null
              : ConversationId.make(values.conversationId),
          author: authority.actor,
          replyToMessageId:
            values.replyToMessageId === null
              ? null
              : MessageId.make(values.replyToMessageId),
          subject: values.subject,
          textBody: values.body || null,
          htmlBody,
          recipients,
          attachments,
        })
        return yield* repository.createDraft(input)
      })

      return yield* repositoryProgram.pipe(
        Effect.provide(makeMailRepositoryLayer(authority.db)),
      )
    }),
  )
}

type MailDraftCommandInput = {
  workspaceId: string
  draftId: string
  expectedRevision: number
}

/** Runs an authenticated member command through the Effect draft application. */
const runMemberDraftCommand = async (
  context: AppRequestContext,
  input: MailDraftCommandInput,
  command: 'requestChanges' | 'discard',
): Promise<DraftSnapshot> =>
  await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceId = yield* decodeWorkspaceId(input.workspaceId)
      const authority = yield* requireMailMemberAuthority(context, workspaceId)
      const repositoryLayer = makeMailRepositoryLayer(authority.db)
      const applicationLayer = mailDraftApplicationLayer.pipe(
        Layer.provide(repositoryLayer),
      )
      const canonical: MemberDraftCommandInput = {
        workspaceId,
        draftId: yield* Schema.decodeUnknownEffect(DraftId)(input.draftId),
        actor: authority.actor,
        expectedRevision: yield* Schema.decodeUnknownEffect(NonNegativeInt)(
          input.expectedRevision,
        ),
      }
      return yield* Effect.gen(function* () {
        const application = yield* MailDraftApplication
        return yield* application[command](canonical)
      }).pipe(Effect.provide(Layer.merge(repositoryLayer, applicationLayer)))
    }),
  )

/** Member requests changes before editing a draft awaiting approval. */
export async function requestPersistedMailDraftChanges(
  context: AppRequestContext,
  input: MailDraftCommandInput,
): Promise<DraftSnapshot> {
  return await runMemberDraftCommand(context, input, 'requestChanges')
}

/** Member discards an active collaborative draft with actor attribution. */
export async function discardPersistedMailDraft(
  context: AppRequestContext,
  input: MailDraftCommandInput,
): Promise<DraftSnapshot> {
  return await runMemberDraftCommand(context, input, 'discard')
}

/**
 * Applies member/agent approval policy and idempotently dispatches one durable
 * delivery Workflow. The deterministic instance id lets a request recover an
 * already-created Workflow without creating another provider-send path.
 */
export async function requestMailDraftDelivery(
  context: AppRequestContext,
  input: { workspaceId: string; draftId: string; expectedRevision: number },
) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceId = yield* decodeWorkspaceId(input.workspaceId)
      const authority = yield* requireMailMemberAuthority(context, workspaceId)
      const repositoryLayer = makeMailRepositoryLayer(authority.db)
      const applicationLayer = mailDraftApplicationLayer.pipe(
        Layer.provide(repositoryLayer),
      )
      const authorization = yield* Effect.gen(function* () {
        const application = yield* MailDraftApplication
        return yield* application.requestDelivery({
          workspaceId,
          draftId: DraftId.make(input.draftId),
          actor: authority.actor,
          expectedRevision: NonNegativeInt.make(input.expectedRevision),
          agentApproval: 'manual',
        })
      }).pipe(Effect.provide(Layer.merge(repositoryLayer, applicationLayer)))
      if (!authorization.startsDelivery) return authorization

      const workflowInstanceId = `mail-${authorization.draft.id}-${authorization.draft.revision}`
      const params: MailDeliveryWorkflowParams = {
        workspaceId,
        draftId: authorization.draft.id,
        actor: authority.actor,
        expectedRevision: authorization.draft.revision,
      }
      yield* Effect.tryPromise({
        try: () =>
          context.env.MAIL_DELIVERY_WORKFLOW.create({
            id: workflowInstanceId,
            params,
          }),
        catch: (cause) =>
          new MailDeliveryDispatchError({
            workflowInstanceId,
            message: 'Garden could not dispatch the mail delivery Workflow.',
            cause,
          }),
      }).pipe(
        Effect.catchTag('MailDeliveryDispatchError', (createError) =>
          Effect.tryPromise({
            try: () =>
              context.env.MAIL_DELIVERY_WORKFLOW.get(workflowInstanceId),
            catch: () => createError,
          }),
        ),
      )
      return { ...authorization, workflowInstanceId }
    }),
  )
}
