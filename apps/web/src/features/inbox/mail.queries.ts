import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  assignMailConversationAgent,
  getMailConversation,
  getMailInboxSnapshot,
  discardPersistedMailDraft,
  mutateMailConversationState,
  persistMailDraft,
  requestPersistedMailDraftChanges,
  requestMailDraftDelivery,
  unassignMailConversationAgent,
  type MailConversationStateAction,
  type MailDraftValuesInput,
  type MailInboxSnapshot,
} from '@/lib/server/mail-api'
import type {
  ConversationActorState,
  ConversationDetail,
  DraftSnapshot,
} from '@garden/server/mail'

const workspaceInput = z.object({ workspaceId: z.uuid() })
const conversationInput = workspaceInput.extend({ conversationId: z.uuid() })
const conversationStateInput = conversationInput.extend({
  action: z.enum([
    'mark-read',
    'mark-unread',
    'archive',
    'unarchive',
    'pin',
    'unpin',
  ]),
})
const draftValuesInput = z.object({
  workspaceId: z.uuid(),
  mailboxId: z.uuid(),
  conversationId: z.uuid().nullable(),
  replyToMessageId: z.uuid().nullable(),
  draftId: z.uuid().nullable(),
  expectedRevision: z.number().int().nonnegative().nullable(),
  to: z.array(z.email()).min(1),
  cc: z.array(z.email()),
  bcc: z.array(z.email()),
  subject: z.string(),
  body: z.string(),
})
const sendDraftInput = workspaceInput.extend({
  draftId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
})
const changeDraftInput = sendDraftInput
const conversationAgentInput = conversationInput.extend({ agentId: z.uuid() })

export const mailKeys = {
  all: (workspaceId: string) => ['garden-mail', workspaceId] as const,
  inbox: (workspaceId: string) =>
    [...mailKeys.all(workspaceId), 'inbox'] as const,
  conversation: (workspaceId: string, conversationId: string) =>
    [...mailKeys.all(workspaceId), 'conversation', conversationId] as const,
}

const getInbox = createServerFn({ method: 'GET' })
  .inputValidator(workspaceInput)
  .handler(({ context, data }) =>
    getMailInboxSnapshot(requireAppRequestContext(context), data.workspaceId),
  )

const getConversation = createServerFn({ method: 'GET' })
  .inputValidator(conversationInput)
  .handler(({ context, data }) =>
    getMailConversation(requireAppRequestContext(context), data),
  )

const changeConversationState = createServerFn({ method: 'POST' })
  .inputValidator(conversationStateInput)
  .handler(({ context, data }) =>
    mutateMailConversationState(requireAppRequestContext(context), data),
  )

const persistDraft = createServerFn({ method: 'POST' })
  .inputValidator(draftValuesInput)
  .handler(({ context, data }) =>
    persistMailDraft(requireAppRequestContext(context), data),
  )

const dispatchDraft = createServerFn({ method: 'POST' })
  .inputValidator(sendDraftInput)
  .handler(({ context, data }) =>
    requestMailDraftDelivery(requireAppRequestContext(context), data),
  )

const reopenDraft = createServerFn({ method: 'POST' })
  .inputValidator(changeDraftInput)
  .handler(({ context, data }) =>
    requestPersistedMailDraftChanges(requireAppRequestContext(context), data),
  )

const discardDraft = createServerFn({ method: 'POST' })
  .inputValidator(changeDraftInput)
  .handler(({ context, data }) =>
    discardPersistedMailDraft(requireAppRequestContext(context), data),
  )

const assignAgent = createServerFn({ method: 'POST' })
  .inputValidator(conversationAgentInput)
  .handler(({ context, data }) =>
    assignMailConversationAgent(requireAppRequestContext(context), data),
  )

const unassignAgent = createServerFn({ method: 'POST' })
  .inputValidator(conversationAgentInput)
  .handler(({ context, data }) =>
    unassignMailConversationAgent(requireAppRequestContext(context), data),
  )

/** Named wrapper keeps the generated server-function declaration portable. */
export async function changeMailConversationState(input: {
  data: {
    workspaceId: string
    conversationId: string
    action: MailConversationStateAction
  }
}): Promise<ConversationActorState> {
  return await changeConversationState(input)
}

/** Named wrapper keeps draft mutation values and result shared with the UI. */
export async function saveMailDraft(input: {
  data: MailDraftValuesInput
}): Promise<DraftSnapshot> {
  return await persistDraft(input)
}

/** Starts the deterministic durable delivery Workflow for a persisted draft. */
export async function sendMailDraft(input: {
  data: { workspaceId: string; draftId: string; expectedRevision: number }
}) {
  return await dispatchDraft(input)
}

/** Records member-requested changes before editing an agent-authored draft. */
export async function requestMailDraftChanges(input: {
  data: { workspaceId: string; draftId: string; expectedRevision: number }
}): Promise<DraftSnapshot> {
  return await reopenDraft(input)
}

/** Discards an active draft through the canonical Effect state machine. */
export async function discardMailDraft(input: {
  data: { workspaceId: string; draftId: string; expectedRevision: number }
}): Promise<DraftSnapshot> {
  return await discardDraft(input)
}

/** Assigns an agent and retains the canonical assignment audit row. */
export async function assignAgentToMailConversation(input: {
  data: { workspaceId: string; conversationId: string; agentId: string }
}) {
  return await assignAgent(input)
}

/** Unassigns an agent without deleting the assignment history. */
export async function unassignAgentFromMailConversation(input: {
  data: { workspaceId: string; conversationId: string; agentId: string }
}) {
  return await unassignAgent(input)
}

/** Actor-scoped mailbox and summary cache shared by Inbox and composer. */
export function mailInboxOptions(workspaceId: string) {
  return queryOptions({
    queryKey: mailKeys.inbox(workspaceId),
    queryFn: (): Promise<MailInboxSnapshot> =>
      getInbox({ data: { workspaceId } }),
    staleTime: 10_000,
  })
}

/** Detailed thread cache is fetched only when the dock selects mail. */
export function mailConversationOptions(
  workspaceId: string,
  conversationId: string,
) {
  return queryOptions({
    queryKey: mailKeys.conversation(workspaceId, conversationId),
    queryFn: (): Promise<ConversationDetail> =>
      getConversation({ data: { workspaceId, conversationId } }),
    staleTime: 10_000,
  })
}
