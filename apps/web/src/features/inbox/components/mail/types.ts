import type { ReactNode } from 'react'

export type MailAddressView = {
  address: string
  name?: string
  avatarUrl?: string
}

export type MailLabelView = {
  id: string
  name: string
  color?: string
}

export type MailAttachmentView = {
  id: string
  filename: string
  contentType: string
  sizeLabel: string
  downloadUrl?: string
  previewUrl?: string
}

export type MailMessageStatus =
  | 'received'
  | 'draft'
  | 'queued'
  | 'sent'
  | 'failed'

export type MailMessageView = {
  id: string
  from: MailAddressView
  to: MailAddressView[]
  cc?: MailAddressView[]
  sentAtLabel: string
  html: string
  textPreview?: string
  status: MailMessageStatus
  draftStatus?:
    | 'editing'
    | 'awaiting_approval'
    | 'approved'
    | 'sending'
    | 'sent'
    | 'send_failed'
    | 'discarded'
  attachments?: MailAttachmentView[]
  agentAuthored?: boolean
  authorLabel?: string
}

export type MailConversationSummaryView = {
  id: string
  subject: string
  participants: MailAddressView[]
  snippet: string
  dateLabel: string
  messageCount: number
  unread: boolean
  starred: boolean
  important?: boolean
  draft?: boolean
  needsReply?: boolean
  labels?: MailLabelView[]
}

export type MailConversationView = MailConversationSummaryView & {
  mailboxId: string
  canSend: boolean
  agentAssignments: ReadonlyArray<{
    assignmentId: string
    agentId: string
  }>
  messages: MailMessageView[]
}

export type MailComposerValues = {
  to: string
  cc: string
  bcc: string
  from: string
  subject: string
  body: string
  htmlBody: string
}

export type MailComposerFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'bullet-list'
  | 'ordered-list'
  | 'link'

export type MailFolderAction = {
  id: string
  label: string
  icon?: ReactNode
}

export type MailScope = 'all' | 'mail' | 'notifications'
