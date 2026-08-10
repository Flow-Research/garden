import type { MailComposerProps } from './components/mail/mail-composer'
import type { MailMessageProps } from './components/mail/mail-message'
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
  toggleImportant: (conversationId: string) => void
  toggleRead: (conversationId: string) => void
  archive: (conversationId: string) => void
  delete: (conversationId: string) => void
  move: (conversationId: string, folderId: string) => void
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
  reason:
    'Garden Mail persistence is present, but the web app has no authenticated actor-scoped mailbox HTTP contract yet.',
}

/**
 * Typed handoff point for the future TanStack Query mail adapter. The web route
 * currently has no mail API, so returning an explicit unavailable state keeps
 * production honest while the composed Inbox can accept a live controller.
 */
export function useMailInboxController(_input: {
  workspaceId: string
  selectedConversationId: string | null
}): MailInboxController {
  return unavailableMailInboxController
}
