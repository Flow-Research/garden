import type { MailComposerProps } from './components/mail/mail-composer'
import type { MailMessageProps } from './components/mail/mail-message'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  AccessibleMailbox,
  ConversationDetail,
  ConversationSummary,
  DraftSnapshot,
  RepositoryMessage,
} from '@garden/server/mail'
import {
  changeMailConversationState,
  discardMailDraft,
  mailConversationOptions,
  mailInboxOptions,
  mailKeys,
  saveMailDraft,
  sendMailDraft,
  requestMailDraftChanges,
} from './mail.queries'
import type {
  MailDraftValuesInput,
  MailInboxSnapshot,
} from '@/lib/server/mail-api'
import { UtcTimestamp } from '@garden/core/mail'
import type {
  MailConversationSummaryView,
  MailConversationView,
  MailFolderAction,
  MailMessageView,
} from './components/mail/types'

export type MailConversationListEntry = {
  conversation: MailConversationSummaryView
  /** ISO timestamp used only for unified notification/mail ordering. */
  sortTimestamp: string
}

export type MailListResult =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | {
      status: 'ready'
      entries: MailConversationListEntry[]
      refreshing?: boolean
      loadingMore?: boolean
    }

export type MailDetailResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'ready'; conversation: MailConversationView }

export type MailComposerController = {
  replyToMessageId?: string
  props: Omit<MailComposerProps, 'variant'>
}

export type MailInboxActions = {
  openComposer: () => void
  closeComposer: () => void
  toggleStar: (conversationId: string) => void
  toggleRead: (conversationId: string) => void
  archive: (conversationId: string) => void
  viewSource: (conversationId: string) => void
  reply: (conversationId: string, messageId?: string) => void
  replyAll: (conversationId: string, messageId?: string) => void
  forward: (conversationId: string, messageId?: string) => void
  messageProps: (
    conversationId: string,
    message: MailMessageView,
  ) => Omit<MailMessageProps, 'message' | 'expanded' | 'onToggleExpanded'>
}

export type ActiveMailInboxController = {
  status: 'active'
  list: MailListResult
  detail: MailDetailResult
  composer: MailComposerController | null
  folders: MailFolderAction[]
  actions: MailInboxActions
}

export type MailInboxController =
  | {
      status: 'unavailable'
      reason: string
    }
  | ActiveMailInboxController

export const unavailableMailInboxController: MailInboxController = {
  status: 'unavailable',
  reason: 'Garden Mail requires an authenticated workspace.',
}

const EMPTY_CONVERSATION_ID = '00000000-0000-4000-8000-000000000000'

type ComposerState = {
  values: MailComposerProps['values']
  conversationId: string | null
  replyToMessageId?: string
  draftId: string | null
  revision: number | null
  ccBccVisible: boolean
  agentAttribution?: string
  error?: string
}

/** Stable UTC labels avoid hydration differences across browser time zones. */
function timestampLabel(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

/** Formats immutable attachment bytes without depending on browser locale. */
function sizeLabel(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

/** Encodes text-only mail into inert HTML consumed by the sandboxed frame. */
function textMailHtml(value: string | null): string {
  if (!value) return ''
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
  return `<pre style="white-space:pre-wrap;font:inherit">${escaped}</pre>`
}

function summaryView(
  summary: ConversationSummary,
): MailConversationSummaryView {
  const participant = summary.lastSenderAddress
    ? [
        {
          address: summary.lastSenderAddress,
          name: summary.lastSenderName ?? undefined,
        },
      ]
    : [{ address: 'No messages yet', name: 'Draft' }]
  return {
    id: summary.id,
    subject: summary.subject,
    participants: participant,
    snippet: summary.snippet,
    dateLabel: timestampLabel(summary.lastMessageAt),
    messageCount: summary.messageCount,
    unread: summary.unread,
    starred: summary.state?.pinned ?? false,
    draft: summary.hasDraft,
    needsReply: summary.needsReply,
  }
}

function attachmentUrl(input: {
  workspaceId: string
  conversationId: string
  messageId: string
  attachmentId: string
}): string {
  return `/api/mail/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(input.attachmentId)}?workspaceId=${encodeURIComponent(input.workspaceId)}&download=1`
}

function messageView(
  workspaceId: string,
  conversationId: string,
  message: RepositoryMessage,
): MailMessageView {
  const recipients = (kind: 'to' | 'cc') =>
    message.recipients
      .filter((recipient) => recipient.kind === kind)
      .map((recipient) => ({
        address: recipient.address,
        name: recipient.displayName ?? undefined,
      }))
  return {
    id: message.id,
    from: {
      address: message.senderAddress,
      name: message.senderName ?? undefined,
    },
    to: recipients('to'),
    cc: recipients('cc'),
    sentAtLabel: timestampLabel(message.authoredAt),
    html: message.htmlBody ?? textMailHtml(message.textBody),
    textPreview: message.textBody ?? undefined,
    status: message.source === 'outbound' ? 'sent' : 'received',
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.fileName,
      contentType: attachment.contentType,
      sizeLabel: sizeLabel(attachment.sizeBytes),
      downloadUrl: attachmentUrl({
        workspaceId,
        conversationId,
        messageId: message.id,
        attachmentId: attachment.id,
      }),
    })),
    agentAuthored: message.author._tag === 'Agent',
    authorLabel:
      message.author._tag === 'Agent'
        ? 'Garden agent'
        : message.author._tag === 'Member'
          ? 'Team member'
          : undefined,
  }
}

function draftView(
  draft: DraftSnapshot,
  mailbox: AccessibleMailbox | undefined,
): MailMessageView {
  const recipients = (kind: 'to' | 'cc') =>
    draft.recipients
      .filter((recipient) => recipient.kind === kind)
      .map((recipient) => ({
        address: recipient.address,
        name: recipient.displayName ?? undefined,
      }))
  return {
    id: draft.id,
    from: { address: mailbox?.primaryAddress ?? 'Unconfigured sender' },
    to: recipients('to'),
    cc: recipients('cc'),
    sentAtLabel: timestampLabel(draft.updatedAt),
    html: draft.htmlBody ?? textMailHtml(draft.textBody),
    textPreview: draft.textBody ?? undefined,
    status: draft.status === 'send_failed' ? 'failed' : 'draft',
    draftStatus: draft.status,
    agentAuthored: draft.author._tag === 'Agent',
    authorLabel: draft.author._tag === 'Agent' ? 'Garden agent' : 'Team member',
  }
}

/** Maps the canonical Effect detail without leaking storage references. */
function detailView(
  workspaceId: string,
  detail: ConversationDetail,
  mailboxes: ReadonlyArray<AccessibleMailbox>,
): MailConversationView {
  const summary = summaryView(detail.conversation)
  const mailbox = mailboxes.find(
    (candidate) => candidate.id === detail.conversation.mailboxId,
  )
  return {
    ...summary,
    messages: [
      ...detail.messages.map((message) =>
        messageView(workspaceId, detail.conversation.id, message),
      ),
      ...detail.drafts.map((draft) => draftView(draft, mailbox)),
    ],
  }
}

function recipientValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

/** Creates the exact server input shared by explicit save and send actions. */
function composerDraftInput(
  workspaceId: string,
  state: ComposerState,
): MailDraftValuesInput {
  return {
    workspaceId,
    mailboxId: state.values.from,
    conversationId: state.conversationId,
    replyToMessageId: state.replyToMessageId ?? null,
    draftId: state.draftId,
    expectedRevision: state.revision,
    to: recipientValues(state.values.to),
    cc: recipientValues(state.values.cc),
    bcc: recipientValues(state.values.bcc),
    subject: state.values.subject,
    body: state.values.body,
  }
}

/**
 * Real TanStack Query adapter over authenticated Effect server functions.
 * Query state stays warm across dock toggles; state mutations update the list
 * optimistically and reconcile with the repository after completion.
 */
export function useMailInboxController(input: {
  workspaceId: string
  selectedConversationId: string | null
}): MailInboxController {
  const queryClient = useQueryClient()
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const inboxQuery = useQuery(mailInboxOptions(input.workspaceId))
  const conversationQuery = useQuery({
    ...mailConversationOptions(
      input.workspaceId,
      input.selectedConversationId ?? EMPTY_CONVERSATION_ID,
    ),
    enabled: input.selectedConversationId !== null,
  })
  const stateMutation = useMutation({
    mutationFn: changeMailConversationState,
    onMutate: async ({ data }) => {
      await queryClient.cancelQueries({
        queryKey: mailKeys.inbox(input.workspaceId),
      })
      const previous = queryClient.getQueryData<MailInboxSnapshot>(
        mailKeys.inbox(input.workspaceId),
      )
      queryClient.setQueryData<MailInboxSnapshot>(
        mailKeys.inbox(input.workspaceId),
        (current) =>
          current
            ? {
                ...current,
                conversations: current.conversations.map((conversation) =>
                  conversation.id !== data.conversationId
                    ? conversation
                    : {
                        ...conversation,
                        unread:
                          data.action === 'mark-read'
                            ? false
                            : data.action === 'mark-unread'
                              ? true
                              : conversation.unread,
                        state: {
                          lastReadMessageId:
                            conversation.state?.lastReadMessageId ?? null,
                          readAt: conversation.state?.readAt ?? null,
                          archivedAt:
                            data.action === 'archive'
                              ? UtcTimestamp.make(new Date().toISOString())
                              : data.action === 'unarchive'
                                ? null
                                : (conversation.state?.archivedAt ?? null),
                          mutedAt: conversation.state?.mutedAt ?? null,
                          pinned:
                            data.action === 'pin'
                              ? true
                              : data.action === 'unpin'
                                ? false
                                : (conversation.state?.pinned ?? false),
                        },
                      },
                ),
              }
            : current,
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          mailKeys.inbox(input.workspaceId),
          context.previous,
        )
      }
      toast.error('Mail action failed')
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: mailKeys.all(input.workspaceId),
      }),
  })
  const draftMutation = useMutation({
    mutationFn: saveMailDraft,
    onSuccess: (draft) => {
      setComposer((current) =>
        current
          ? { ...current, draftId: draft.id, revision: draft.revision }
          : current,
      )
      void queryClient.invalidateQueries({
        queryKey: mailKeys.all(input.workspaceId),
      })
    },
    onError: (error) => {
      setComposer((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : 'Draft failed.',
            }
          : current,
      )
    },
  })
  const sendMutation = useMutation({
    mutationFn: sendMailDraft,
    onSuccess: (result) => {
      if (result.waitsForApproval) {
        toast.success('Draft sent for approval')
      } else {
        toast.success('Message queued for delivery')
      }
      setComposer(null)
      void queryClient.invalidateQueries({
        queryKey: mailKeys.all(input.workspaceId),
      })
    },
    onError: (error) => {
      setComposer((current) =>
        current
          ? {
              ...current,
              error:
                error instanceof Error
                  ? error.message
                  : 'Delivery could not be queued.',
            }
          : current,
      )
    },
  })
  const requestChangesMutation = useMutation({
    mutationFn: requestMailDraftChanges,
    onError: () => toast.error('Draft could not be reopened for editing'),
  })
  const discardMutation = useMutation({
    mutationFn: discardMailDraft,
    onSuccess: () => {
      toast.success('Draft discarded')
      void queryClient.invalidateQueries({
        queryKey: mailKeys.all(input.workspaceId),
      })
    },
    onError: () => toast.error('Draft could not be discarded'),
  })

  const mailboxes = inboxQuery.data?.mailboxes ?? []
  const summaries = inboxQuery.data?.conversations ?? []
  const summaryById = useMemo(
    () =>
      new Map<string, ConversationSummary>(
        summaries.map((summary) => [summary.id, summary]),
      ),
    [summaries],
  )
  const beginCompose = (
    conversationId: string | null,
    replyToMessageId?: string,
    mode: 'reply' | 'reply-all' | 'forward' = 'reply',
  ) => {
    const detail = conversationQuery.data
    const summary =
      conversationId === null ? null : summaryById.get(conversationId)
    const mailbox =
      mailboxes.find((candidate) => candidate.id === summary?.mailboxId) ??
      mailboxes[0]
    if (!mailbox) {
      toast.error('Create a mailbox in Settings before composing mail.')
      return
    }
    const source =
      detail?.messages.find((message) => message.id === replyToMessageId) ??
      detail?.messages.at(-1)
    const ownAddresses = new Set<string>(
      mailboxes
        .map((candidate) => candidate.primaryAddress)
        .filter((address) => address !== null),
    )
    const replyAll = source
      ? [
          source.senderAddress,
          ...source.recipients.map((recipient) => recipient.address),
        ].filter((address) => !ownAddresses.has(address))
      : []
    const to =
      mode === 'forward'
        ? ''
        : mode === 'reply-all'
          ? [...new Set(replyAll)].join(', ')
          : (source?.senderAddress ?? '')
    const originalSubject = summary?.subject ?? ''
    const subject =
      mode === 'forward'
        ? originalSubject.match(/^fwd:/i)
          ? originalSubject
          : `Fwd: ${originalSubject}`
        : originalSubject && !originalSubject.match(/^re:/i)
          ? `Re: ${originalSubject}`
          : originalSubject
    setComposer({
      values: {
        to,
        cc: '',
        bcc: '',
        from: mailbox.id,
        subject,
        body: '',
      },
      conversationId,
      replyToMessageId:
        mode === 'forward' ? undefined : (replyToMessageId ?? source?.id),
      draftId: null,
      revision: null,
      ccBccVisible: mode === 'reply-all',
    })
  }

  /** Opens the exact persisted revision so collaborative edits stay optimistic. */
  const beginEditDraft = (draft: DraftSnapshot) => {
    const mailbox = mailboxes.find(
      (candidate) => candidate.id === draft.mailboxId,
    )
    if (!mailbox) {
      toast.error('Mailbox access is no longer available.')
      return
    }
    const addresses = (kind: 'to' | 'cc' | 'bcc') =>
      draft.recipients
        .filter((recipient) => recipient.kind === kind)
        .map((recipient) => recipient.address)
        .join(', ')
    const cc = addresses('cc')
    const bcc = addresses('bcc')
    setComposer({
      values: {
        to: addresses('to'),
        cc,
        bcc,
        from: mailbox.id,
        subject: draft.subject,
        body: draft.textBody ?? '',
      },
      conversationId: draft.conversationId,
      ...(draft.replyToMessageId
        ? { replyToMessageId: draft.replyToMessageId }
        : {}),
      draftId: draft.id,
      revision: draft.revision,
      ccBccVisible: cc.length > 0 || bcc.length > 0,
      ...(draft.author._tag === 'Agent'
        ? { agentAttribution: 'Agent-authored draft' }
        : {}),
    })
  }

  const list: MailListResult = inboxQuery.isPending
    ? { status: 'loading' }
    : inboxQuery.isError
      ? {
          status: 'error',
          message: inboxQuery.error.message,
          retry: () => void inboxQuery.refetch(),
        }
      : {
          status: 'ready',
          entries: summaries
            .filter(
              (summary) => summary.state?.archivedAt === null || !summary.state,
            )
            .map((summary) => ({
              conversation: summaryView(summary),
              sortTimestamp:
                summary.lastMessageAt ?? '1970-01-01T00:00:00.000Z',
            })),
          refreshing: inboxQuery.isFetching,
        }
  const detail: MailDetailResult = !input.selectedConversationId
    ? { status: 'idle' }
    : conversationQuery.isPending
      ? { status: 'loading' }
      : conversationQuery.isError
        ? {
            status: 'error',
            message: conversationQuery.error.message,
            retry: () => void conversationQuery.refetch(),
          }
        : {
            status: 'ready',
            conversation: detailView(
              input.workspaceId,
              conversationQuery.data,
              mailboxes,
            ),
          }

  const mutateState = (
    conversationId: string,
    action: Parameters<typeof changeMailConversationState>[0]['data']['action'],
  ) =>
    stateMutation.mutate({
      data: { workspaceId: input.workspaceId, conversationId, action },
    })

  return {
    status: 'active',
    list,
    detail,
    folders: [],
    composer: composer
      ? {
          ...(composer.replyToMessageId
            ? { replyToMessageId: composer.replyToMessageId }
            : {}),
          props: {
            values: composer.values,
            fromOptions: mailboxes.map((mailbox) => ({
              value: mailbox.id,
              label: mailbox.primaryAddress ?? mailbox.name,
            })),
            ccBccVisible: composer.ccBccVisible,
            savingDraft: draftMutation.isPending,
            sending: sendMutation.isPending,
            error: composer.error,
            agentAttribution: composer.agentAttribution,
            onChange: (values) =>
              setComposer((current) =>
                current ? { ...current, values, error: undefined } : current,
              ),
            onToggleCcBcc: () =>
              setComposer((current) =>
                current
                  ? { ...current, ccBccVisible: !current.ccBccVisible }
                  : current,
              ),
            onSend: () => {
              if (!composer) return
              draftMutation.mutate(
                {
                  data: composerDraftInput(input.workspaceId, composer),
                },
                {
                  onSuccess: (draft) =>
                    sendMutation.mutate({
                      data: {
                        workspaceId: input.workspaceId,
                        draftId: draft.id,
                        expectedRevision: draft.revision,
                      },
                    }),
                },
              )
            },
            onSaveDraft: () => {
              if (!composer) return
              draftMutation.mutate({
                data: composerDraftInput(input.workspaceId, composer),
              })
            },
            onDiscard: () => setComposer(null),
            onClose: () => setComposer(null),
          },
        }
      : null,
    actions: {
      openComposer: () => beginCompose(null),
      closeComposer: () => setComposer(null),
      toggleStar: (conversationId) => {
        const summary = summaryById.get(conversationId)
        mutateState(conversationId, summary?.state?.pinned ? 'unpin' : 'pin')
      },
      toggleRead: (conversationId) =>
        mutateState(
          conversationId,
          summaryById.get(conversationId)?.unread ? 'mark-read' : 'mark-unread',
        ),
      archive: (conversationId) => mutateState(conversationId, 'archive'),
      viewSource: (conversationId) => {
        const messageId =
          conversationQuery.data?.conversation.id === conversationId
            ? conversationQuery.data.messages.at(-1)?.id
            : undefined
        if (!messageId || typeof window === 'undefined') return
        window.open(
          `/api/mail/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/raw?workspaceId=${encodeURIComponent(input.workspaceId)}`,
          '_blank',
          'noopener,noreferrer',
        )
      },
      reply: (conversationId, messageId) =>
        beginCompose(conversationId, messageId, 'reply'),
      replyAll: (conversationId, messageId) =>
        beginCompose(conversationId, messageId, 'reply-all'),
      forward: (conversationId, messageId) =>
        beginCompose(conversationId, messageId, 'forward'),
      messageProps: (conversationId, message) =>
        message.draftStatus
          ? {
              ...(message.draftStatus !== 'sending'
                ? {
                    onSendDraft: () => {
                      const draft = conversationQuery.data?.drafts.find(
                        (candidate) => candidate.id === message.id,
                      )
                      if (!draft) return
                      sendMutation.mutate({
                        data: {
                          workspaceId: input.workspaceId,
                          draftId: draft.id,
                          expectedRevision: draft.revision,
                        },
                      })
                    },
                  }
                : {}),
              ...(message.draftStatus === 'editing' ||
              message.draftStatus === 'awaiting_approval'
                ? {
                    onEditDraft: () => {
                      const draft = conversationQuery.data?.drafts.find(
                        (candidate) => candidate.id === message.id,
                      )
                      if (!draft) return
                      if (draft.status === 'awaiting_approval') {
                        requestChangesMutation.mutate(
                          {
                            data: {
                              workspaceId: input.workspaceId,
                              draftId: draft.id,
                              expectedRevision: draft.revision,
                            },
                          },
                          { onSuccess: beginEditDraft },
                        )
                        return
                      }
                      beginEditDraft(draft)
                    },
                  }
                : {}),
              ...(message.draftStatus !== 'sending'
                ? {
                    onDiscardDraft: () => {
                      const draft = conversationQuery.data?.drafts.find(
                        (candidate) => candidate.id === message.id,
                      )
                      if (!draft) return
                      discardMutation.mutate({
                        data: {
                          workspaceId: input.workspaceId,
                          draftId: draft.id,
                          expectedRevision: draft.revision,
                        },
                      })
                    },
                  }
                : {}),
            }
          : {
              onReply: () => beginCompose(conversationId, message.id, 'reply'),
              onReplyAll: () =>
                beginCompose(conversationId, message.id, 'reply-all'),
              onForward: () =>
                beginCompose(conversationId, message.id, 'forward'),
            },
    },
  }
}
