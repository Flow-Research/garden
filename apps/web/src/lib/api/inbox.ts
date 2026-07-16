import type { InboxItem } from '@garden/core/types'
import { getApiTransport } from './state'

export function listInbox(params?: { workspace_id?: string }): Promise<InboxItem[]> {
  const search = new URLSearchParams()
  if (params?.workspace_id) search.set('workspace_id', params.workspace_id)
  const suffix = search.size ? `?${search}` : ''
  return getApiTransport().request(`/api/inbox${suffix}`)
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

/**
 * Resolves an inbox approval by stable request ID. Server dispatches Garden
 * agent proposals to the dedicated ledger and connector approvals to the
 * legacy permission ledger, so the existing client contract stays unchanged.
 */
export function resolvePermissionRequest(args: {
  id: string
  approved: boolean
}): Promise<{
  ok: true
  invalidations: string[]
}> {
  return getApiTransport().request(
    `/api/permission-requests/${encodeURIComponent(args.id)}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({ approved: args.approved }),
    },
  )
}
