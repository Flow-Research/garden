import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '@garden/core/types'

const listInbox = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: { listInbox },
}))

import {
  deduplicateInboxItems,
  groupInboxItems,
  inboxListOptions,
} from './queries'

function inboxItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: 'inbox-item',
    workspace_id: 'workspace-1',
    recipient_type: 'member',
    recipient_id: 'member-1',
    actor_type: 'agent',
    actor_id: 'agent-1',
    type: 'new_comment',
    severity: 'attention',
    issue_id: 'issue-1',
    title: 'API notification',
    body: 'Message from the API',
    issue_status: 'in_progress',
    read: false,
    archived: false,
    created_at: '2026-09-17T10:00:00.000Z',
    details: null,
    ...overrides,
  }
}

describe('inbox queries', () => {
  it('loads inbox items for the requested workspace', async () => {
    const items = [inboxItem({ id: 'api-item' })]
    listInbox.mockResolvedValue(items)

    const options = inboxListOptions('workspace-1')
    const result = await options.queryFn!({
      client: new QueryClient(),
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
    })

    expect(result).toBe(items)
    expect(listInbox).toHaveBeenCalledWith({ workspace_id: 'workspace-1' })
  })

  it('keeps the newest API item for each issue and removes archived items', () => {
    const newest = inboxItem({
      id: 'newest-api-item',
      created_at: '2026-09-17T11:00:00.000Z',
    })
    const older = inboxItem({
      id: 'older-api-item',
      created_at: '2026-09-17T09:00:00.000Z',
    })
    const archived = inboxItem({
      id: 'archived-api-item',
      issue_id: 'issue-2',
      archived: true,
    })

    expect(deduplicateInboxItems([older, archived, newest])).toEqual([newest])
  })

  it('retains every active event in an issue thread ordered newest first', () => {
    const comment = inboxItem({
      id: 'comment',
      type: 'new_comment',
      created_at: '2026-09-17T15:25:42.740Z',
    })
    const review = inboxItem({
      id: 'review',
      type: 'wp_review',
      created_at: '2026-09-17T15:25:48.066Z',
      read: true,
    })

    expect(groupInboxItems([comment, review])).toEqual([
      expect.objectContaining({
        id: 'issue:issue-1',
        issueId: 'issue-1',
        items: [review, comment],
        latest: review,
        read: false,
        summary: { ...review, read: false },
      }),
    ])
  })

  it('keeps notifications without an issue in separate threads', () => {
    const first = inboxItem({ id: 'first', issue_id: null })
    const second = inboxItem({ id: 'second', issue_id: null })

    expect(groupInboxItems([first, second]).map((thread) => thread.id)).toEqual(
      ['item:first', 'item:second'],
    )
  })
})
