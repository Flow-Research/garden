export type GmailView = 'drafts' | 'sent'

export interface GmailEmailSummary {
  readonly id: string
  readonly threadId: string | null
  readonly subject: string
  readonly snippet: string
  readonly from: string
  readonly to: string
  readonly date: string | null
}

export interface GmailDraftSummary extends GmailEmailSummary {
  readonly draftId: string
}

export interface GmailListResponse {
  readonly items: readonly GmailEmailSummary[] | readonly GmailDraftSummary[]
  readonly nextCursor: string | null
}

export interface GmailDraftDetail {
  readonly draftId: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly subject: string
  readonly bodyText: string
}

export interface GmailComposeInput {
  readonly draftId?: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly subject: string
  readonly body: string
}

export interface GmailSendResponse {
  readonly id: string
  readonly draftId: string | null
}

export type GmailErrorCode =
  | 'gmail_not_connected'
  | 'gmail_blocked'
  | 'gmail_tool_unavailable'
  | 'gmail_provider_failed'
