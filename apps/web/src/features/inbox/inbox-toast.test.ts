import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { InboxItem } from '@garden/core/types'
import { inboxKeys } from '@/lib/inbox/queries'

const toastSpy = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast: toastSpy }))

import { selectInboxToastItems, subscribeInboxToasts } from './inbox-toast'

function inboxItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: 'inbox-item',
    workspace_id: 'workspace-1',
    recipient_type: 'member',
    recipient_id: 'member-1',
    actor_type: 'agent',
    actor_id: 'agent-1',
    type: 'new_comment',
    severity: 'action_required',
    issue_id: 'issue-1',
    title: 'Action needed',
    body: 'Details here',
    issue_status: 'in_progress',
    read: false,
    archived: false,
    created_at: '2026-09-17T10:00:00.000Z',
    details: null,
    ...overrides,
  }
}

describe('selectInboxToastItems', () => {
  it('returns unread unarchived action_required items missing from seen', () => {
    const toastable = inboxItem({ id: 'toastable' })
    expect(selectInboxToastItems(new Set(), [toastable])).toEqual([toastable])
  })

  it('excludes read items', () => {
    const read = inboxItem({ id: 'read', read: true })
    expect(selectInboxToastItems(new Set(), [read])).toEqual([])
  })

  it('excludes archived items', () => {
    const archived = inboxItem({ id: 'archived', archived: true })
    expect(selectInboxToastItems(new Set(), [archived])).toEqual([])
  })

  it('excludes attention and info severities', () => {
    const items = [
      inboxItem({ id: 'attention', severity: 'attention' }),
      inboxItem({ id: 'info', severity: 'info' }),
    ]
    expect(selectInboxToastItems(new Set(), items)).toEqual([])
  })

  it('excludes ids already in seen', () => {
    const seenItem = inboxItem({ id: 'seen' })
    expect(selectInboxToastItems(new Set(['seen']), [seenItem])).toEqual([])
  })

  it('returns empty for empty inputs', () => {
    expect(selectInboxToastItems(new Set(), [])).toEqual([])
    expect(selectInboxToastItems(new Set(['seen']), [])).toEqual([])
  })

  it('leaves the seen set untouched', () => {
    const seen = new Set<string>()
    selectInboxToastItems(seen, [inboxItem({ id: 'fresh' })])
    expect(seen.size).toBe(0)
  })
})

describe('subscribeInboxToasts', () => {
  it('primes on the first payload, then toasts each new arrival once', () => {
    toastSpy.mockClear()
    const queryClient = new QueryClient()
    const key = inboxKeys.list('workspace-toast')
    const unsubscribe = subscribeInboxToasts({
      queryClient,
      workspaceId: 'workspace-toast',
      onOpen: () => {},
    })

    queryClient.setQueryData(key, [
      inboxItem({ id: 'first', issue_id: null }),
    ])
    expect(toastSpy).not.toHaveBeenCalled()

    queryClient.setQueryData(key, [
      inboxItem({ id: 'first', issue_id: null }),
      inboxItem({ id: 'second', issue_id: null, title: 'Second arrival' }),
    ])
    expect(toastSpy).toHaveBeenCalledTimes(1)
    expect(toastSpy.mock.calls[0]?.[0]).toBe('Second arrival')

    queryClient.setQueryData(key, [
      inboxItem({ id: 'first', issue_id: null }),
      inboxItem({ id: 'second', issue_id: null, title: 'Second arrival' }),
    ])
    expect(toastSpy).toHaveBeenCalledTimes(1)

    queryClient.setQueryData(key, [
      inboxItem({ id: 'first', issue_id: null }),
      inboxItem({ id: 'second', issue_id: null, title: 'Second arrival' }),
      inboxItem({ id: 'third', issue_id: null, title: 'Third arrival' }),
    ])
    expect(toastSpy).toHaveBeenCalledTimes(2)
    expect(toastSpy.mock.calls[1]?.[0]).toBe('Third arrival')

    unsubscribe()
  })
})
