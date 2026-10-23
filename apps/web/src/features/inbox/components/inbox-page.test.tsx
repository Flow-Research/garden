import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { api } from '@/lib/api'
import { inboxKeys } from '@/lib/inbox/queries'
import { InboxPage } from './inbox-page'

// A small URL store standing in for the router: the page reads its search
// params and writes them back with replace/push, re-rendering on change.
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = {
    search: '',
    setSearch(search: string) {
      state.search = search
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    navigate(path: string) {
      state.setSearch(path.split('?')[1] ?? '')
    },
  }
  return state
})
const mocks = vi.hoisted(() => ({
  createComment: vi.fn(),
}))

vi.mock('../../navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useNavigation: () => {
      const search = useSyncExternalStore(nav.subscribe, () => nav.search)
      return {
        searchParams: new URLSearchParams(search),
        replace: nav.navigate,
        push: nav.navigate,
        back: () => {},
      }
    },
  }
})
vi.mock('@/features/navigation/use-surface-navigation', () => ({
  useSurfaceNavigation: () => ({ openIssue: vi.fn() }),
}))
vi.mock('@/lib/workspace/hooks', () => ({
  useActorName: () => ({ getActorName: () => 'Ada' }),
}))
vi.mock('./inbox-control-plane', () => ({ InboxControlPlane: () => null }))
vi.mock('./inbox-item-preview', () => ({ InboxItemPreviewCard: () => null }))
vi.mock('@/lib/api', () => ({
  api: {
    listInbox: vi.fn(async () => []),
    listGmail: vi.fn(async () => ({ items: [], nextCursor: null })),
    createComment: mocks.createComment,
    markInboxRead: vi.fn(async () => undefined),
  },
}))

const WS_ID = 'ws-test'

function inboxItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: 'item-a',
    workspace_id: WS_ID,
    recipient_type: 'member',
    recipient_id: 'user-1',
    actor_type: 'member',
    actor_id: 'user-2',
    type: 'new_comment',
    severity: 'info',
    issue_id: 'issue-a',
    title: 'Issue A',
    body: 'A comment',
    issue_status: 'todo',
    read: true,
    archived: false,
    created_at: '2026-10-20T10:00:00.000Z',
    details: null,
    ...overrides,
  }
}

const THREAD_A = inboxItem({})
const THREAD_B = inboxItem({
  id: 'item-b',
  issue_id: 'issue-b',
  title: 'Issue B',
  created_at: '2026-10-20T11:00:00.000Z',
})

function renderInbox() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(inboxKeys.list(WS_ID), [THREAD_A, THREAD_B])
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS_ID}>
        <InboxPage />
      </WorkspaceIdProvider>
    </QueryClientProvider>
  )
  const result = render(ui())
  return {
    select(threadId: string) {
      nav.setSearch(new URLSearchParams({ item: threadId }).toString())
      result.rerender(ui())
    },
  }
}

function replyBox() {
  return screen.getByRole('textbox', { name: /reply/i })
}

describe('InboxPage reply box', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nav.setSearch(new URLSearchParams({ item: 'issue:issue-a' }).toString())
  })

  it('starts empty when another thread is selected', () => {
    const inbox = renderInbox()
    const box = replyBox()
    box.textContent = 'Reply meant for issue A'
    fireEvent.input(box)

    inbox.select('issue:issue-b')

    expect(screen.getByText('Issue B', { selector: 'h1, h2, h3' })).toBeTruthy()
    expect(replyBox().textContent).toBe('')
  })
})

describe('InboxPage list states', () => {
  it('says the inbox failed to load, and loads it on retry', async () => {
    vi.mocked(api.listInbox)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([THREAD_A])
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WorkspaceIdProvider wsId={WS_ID}>
          <InboxPage />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading inbox...')).toBeInTheDocument()
    expect(
      await screen.findByText('Could not load your inbox.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No messages')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect((await screen.findAllByText('Issue A')).length).toBeGreaterThan(0)
  })
})

describe('InboxPage Gmail paging', () => {
  function email(id: string, subject: string) {
    return {
      id,
      threadId: null,
      subject,
      snippet: '',
      from: 'ada@example.com',
      to: 'grace@example.com',
      date: null,
    }
  }

  it('drops a page that arrives after switching to another view', async () => {
    let resolveMore: (page: unknown) => void = () => {}
    vi.mocked(api.listGmail).mockImplementation(
      async (view: string, cursor?: string | null) => {
        if (cursor) {
          return new Promise((resolve) => {
            resolveMore = resolve
          }) as never
        }
        return view === 'drafts'
          ? { items: [email('d1', 'Draft one')], nextCursor: 'next' }
          : { items: [email('s1', 'Sent one')], nextCursor: null }
      },
    )
    renderInbox()

    fireEvent.click(screen.getByRole('button', { name: 'In draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sent' }))
    expect(await screen.findByText('Sent one')).toBeInTheDocument()

    await act(async () => {
      resolveMore({ items: [email('d2', 'Draft two')], nextCursor: null })
    })

    expect(screen.queryByText('Draft two')).toBeNull()
    expect(screen.getByText('Sent one')).toBeInTheDocument()
  })
})

describe('InboxPage filter in the URL', () => {
  beforeEach(() => {
    vi.mocked(api.listGmail).mockResolvedValue({ items: [], nextCursor: null })
  })

  it('opens on the filter named in the URL', async () => {
    nav.setSearch('filter=sent')
    renderInbox()
    expect(await screen.findByText('No sent messages')).toBeInTheDocument()
    expect(api.listGmail).toHaveBeenCalledWith('sent')
  })

  it('writes the chosen filter to the URL', () => {
    nav.setSearch('')
    renderInbox()
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))
    expect(new URLSearchParams(nav.search).get('filter')).toBe('unread')

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(new URLSearchParams(nav.search).has('filter')).toBe(false)
  })
})
