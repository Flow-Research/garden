import type { InboxItem } from '@garden/core/types'
import { getApiTransport } from './state'

export function listInbox(): Promise<InboxItem[]> {
  return getApiTransport().request('/api/inbox')
}

export function markInboxRead(id: string): Promise<InboxItem> {
  return getApiTransport().request(
    `/api/inbox/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  )
}

export function archiveInbox(id: string): Promise<InboxItem> {
  return getApiTransport().request(
    `/api/inbox/${encodeURIComponent(id)}/archive`,
    { method: 'POST' },
  )
}

export function markAllInboxRead(): Promise<{ count: number }> {
  return getApiTransport().request('/api/inbox/mark-all-read', { method: 'POST' })
}

export function archiveAllInbox(): Promise<{ count: number }> {
  return getApiTransport().request('/api/inbox/archive-all', { method: 'POST' })
}

export function archiveAllReadInbox(): Promise<{ count: number }> {
  return getApiTransport().request('/api/inbox/archive-all-read', {
    method: 'POST',
  })
}

export function archiveCompletedInbox(): Promise<{ count: number }> {
  return getApiTransport().request('/api/inbox/archive-completed', {
    method: 'POST',
  })
}
