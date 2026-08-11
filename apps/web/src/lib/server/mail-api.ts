import {
  AgentId,
  ConversationId,
  CreateDraftInput,
  DraftId,
  EmailAddress,
  MailActor,
  MailAddressId,
  MailboxId,
  MessageId,
  NonNegativeInt,
  SaveDraftInput,
  UpdateConversationStateInput,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import { mailAddress } from '@garden/db/schema'
import {
  MailRepository,
  MailDraftApplication,
  mailDraftApplicationLayer,
  makeMailRepositoryLayer,
  type AccessibleMailbox,
  type AssignmentSnapshot,
  type ConversationActorState,
  type ConversationDetail,
  type ConversationSummary,
  type DraftSnapshot,
  type MemberDraftCommandInput,
} from '@garden/server/mail'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import type { AppRequestContext } from './context'
import { requireMailMemberAuthority } from './mail-authority'
import type { MailDeliveryWorkflowParams } from './mail-delivery-workflow'

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
}

export type MailConversationStateAction =
  | 'mark-read'
  | 'mark-unread'
  | 'archive'
  | 'unarchive'
  | 'pin'
  | 'unpin'

export type MailInboxSnapshot = {
  mailboxes: ReadonlyArray<AccessibleMailbox>
  conversations: ReadonlyArray<ConversationSummary>
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
    }).pipe(Effect.provide(makeMailRepositoryLayer(authority.db)))
  })

/** Lists actor-visible mailboxes and their conversations in one request. */
export async function getMailInboxSnapshot(
  context: AppRequestContext,
  workspaceId: string,
): Promise<MailInboxSnapshot> {
  return await Effect.runPromise(
    withMemberRepository(context, workspaceId, ({ workspaceId, actor }) =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const mailboxes = yield* repository.listMailboxes({
          workspaceId,
          actor,
        })
        const conversations = yield* repository.listConversations({
          workspaceId,
          actor,
          mailboxId: null,
        })
        return { mailboxes, conversations }
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
    withMemberRepository(context, input.workspaceId, ({ workspaceId, actor }) =>
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
        return yield* repository.assignConversation({
          workspaceId,
          conversationId: yield* Schema.decodeUnknownEffect(ConversationId)(
            input.conversationId,
          ),
          assignee: {
            _tag: 'Agent',
            agentId: yield* Schema.decodeUnknownEffect(AgentId)(input.agentId),
          },
          assignedBy: actor,
        })
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
        if (values.draftId !== null) {
          const input = yield* Schema.decodeUnknownEffect(SaveDraftInput)({
            workspaceId,
            draftId: DraftId.make(values.draftId),
            actor: authority.actor,
            expectedRevision: NonNegativeInt.make(values.expectedRevision ?? 0),
            subject: values.subject,
            textBody: values.body || null,
            htmlBody: null,
            recipients,
            attachments: [],
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
        if (!address) {
          return yield* new MailDraftSetupError({
            mailboxId,
            message: 'Mailbox has no active sender.',
          })
        }

        const input = yield* Schema.decodeUnknownEffect(CreateDraftInput)({
          workspaceId,
          mailboxId,
          fromAddressId: MailAddressId.make(address.id),
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
          htmlBody: null,
          recipients,
          attachments: [],
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
