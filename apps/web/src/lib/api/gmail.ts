import type {
  GmailComposeInput,
  GmailDraftDetail,
  GmailEmailSummary,
  GmailListResponse,
  GmailSendResponse,
  GmailView,
} from './gmail-contract'
import { getApiTransport } from './state'

export function listGmail(
  view: GmailView,
  cursor?: string,
): Promise<GmailListResponse> {
  const search = new URLSearchParams()
  if (cursor) search.set('cursor', cursor)
  const suffix = search.size ? `?${search}` : ''
  const path = view === 'drafts' ? '/api/gmail/drafts' : '/api/gmail/messages'
  return getApiTransport().request(`${path}${suffix}`)
}

export function getGmailDraft(draftId: string): Promise<GmailDraftDetail> {
  return getApiTransport().request(
    `/api/gmail/drafts/${encodeURIComponent(draftId)}`,
  )
}

export function getGmailMessage(id: string): Promise<GmailEmailSummary> {
  const search = new URLSearchParams({ id })
  return getApiTransport().request(`/api/gmail/messages?${search}`)
}

export function saveGmailDraft(
  input: GmailComposeInput,
): Promise<GmailDraftDetail> {
  return getApiTransport().request('/api/gmail/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteGmailDraft(draftId: string): Promise<{ ok: true }> {
  return getApiTransport().request(
    `/api/gmail/drafts/${encodeURIComponent(draftId)}`,
    { method: 'DELETE' },
  )
}

export function sendGmail(
  input: GmailComposeInput,
): Promise<GmailSendResponse> {
  return getApiTransport().request('/api/gmail/send', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
