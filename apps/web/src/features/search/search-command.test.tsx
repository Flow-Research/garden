import { act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchCommand } from './search-command'
import { useSearchStore } from './search-store'

const {
  mockSearchIssues,
  mockSearchProjects,
  mockRecentItems,
  mockAllIssues,
  mockOpenPanel,
  mockOpenSettingsDialog,
  mockGetNextIdleSession,
  mockSetActiveSession,
} = vi.hoisted(() => ({
  mockSearchIssues: vi.fn(),
  mockSearchProjects: vi.fn(),
  mockRecentItems: { current: [] as Array<{ id: string; visitedAt: number }> },
  mockAllIssues: { current: [] as Array<Record<string, unknown>> },
  mockOpenPanel: vi.fn(),
  mockOpenSettingsDialog: vi.fn(),
  mockGetNextIdleSession: vi
    .fn()
    .mockResolvedValue({ id: 'session-new', title: 'New Chat' }),
  mockSetActiveSession: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    searchIssues: mockSearchIssues,
    searchProjects: mockSearchProjects,
  },
}))

vi.mock('@garden/core/issues/stores', () => ({
  useRecentIssuesStore: (
    selector?: (state: { items: typeof mockRecentItems.current }) => unknown,
  ) => {
    const state = { items: mockRecentItems.current }
    return selector ? selector(state) : state
  },
}))

vi.mock('@garden/core', () => ({
  useWorkspaceId: () => 'ws-test',
}))

vi.mock('@garden/core/issues/queries', () => ({
  issueListOptions: () => ({
    queryKey: ['issues', 'ws-test', 'list'],
    enabled: false,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockAllIssues.current }),
}))

vi.mock('../navigation', () => ({
  useNavigation: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('@garden/core/chat', () => ({
  useChatStore: Object.assign(
    (
      selector?: (state: {
        activeSessionId: string | null
        setActiveSession: typeof mockSetActiveSession
      }) => unknown,
    ) => {
      const state = {
        activeSessionId: null,
        setActiveSession: mockSetActiveSession,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        activeSessionId: null,
        setActiveSession: mockSetActiveSession,
      }),
    },
  ),
}))

vi.mock('@/components/shell/workspace-dock', () => ({
  useWorkspaceDock: () => ({
    openPanel: mockOpenPanel,
  }),
}))

vi.mock('@/features/chat/use-agent-chat-sessions', () => ({
  useAgentSessions: () => ({
    claimWarmSession: mockGetNextIdleSession,
  }),
}))

vi.mock('@/features/settings', () => ({
  useSettingsDialogStore: (
    selector?: (state: { openSettings: typeof mockOpenSettingsDialog }) => unknown,
  ) => {
    const state = { openSettings: mockOpenSettingsDialog }
    return selector ? selector(state) : state
  },
}))

describe('SearchCommand', () => {
  beforeEach(() => {
    mockSearchIssues.mockReset().mockResolvedValue({ issues: [] })
    mockSearchProjects.mockReset().mockResolvedValue({ projects: [] })
    mockOpenPanel.mockReset()
    mockGetNextIdleSession.mockReset().mockResolvedValue({
      id: 'session-new',
      title: 'New Chat',
    })
    mockSetActiveSession.mockReset()
    mockRecentItems.current = []
    mockAllIssues.current = []

    // cmdk calls scrollIntoView on the first selected item, which jsdom doesn't implement
    Element.prototype.scrollIntoView = vi.fn()

    act(() => {
      useSearchStore.setState({ open: true })
    })
  })

  it('closes on a single Escape press from the search input', async () => {
    const user = userEvent.setup()

    render(<SearchCommand />)

    const input = screen.getByPlaceholderText('Search issues or open a panel...')
    await user.click(input)

    expect(useSearchStore.getState().open).toBe(true)

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(useSearchStore.getState().open).toBe(false)
    })
    expect(
      screen.queryByPlaceholderText('Type a command or search...'),
    ).not.toBeInTheDocument()
  })

  it('does not show pages when no query is entered', () => {
    render(<SearchCommand />)

    expect(screen.queryByText('Panels')).not.toBeInTheDocument()
  })

  it('filters navigation pages by query', async () => {
    const user = userEvent.setup()
    render(<SearchCommand />)

    const input = screen.getByPlaceholderText('Search issues or open a panel...')
    await user.type(input, 'skill')

    await waitFor(() => {
      // HighlightText splits text, so use a function matcher
      expect(
        screen.getByText(
          (_, el) => el?.textContent === 'Skills' && el?.tagName === 'SPAN',
        ),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Projects')).not.toBeInTheDocument()
  })

  it('opens settings dialog via quick action', async () => {
    const user = userEvent.setup()
    render(<SearchCommand />)

    // Quick actions show when the query is empty.
    const settingsItem = await screen.findByText('Open Settings')
    await user.click(settingsItem)

    expect(mockOpenSettingsDialog).toHaveBeenCalled()
    expect(mockOpenPanel).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'settings' }),
    )
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('renders recent issues from query cache joined with store visit records', () => {
    mockRecentItems.current = [
      { id: 'issue-1', visitedAt: 1000 },
      { id: 'issue-2', visitedAt: 900 },
    ]
    mockAllIssues.current = [
      {
        id: 'issue-1',
        identifier: 'MUL-1',
        title: 'First issue',
        status: 'todo',
      },
      {
        id: 'issue-2',
        identifier: 'MUL-2',
        title: 'Second issue',
        status: 'done',
      },
    ]

    render(<SearchCommand />)

    expect(screen.getByText('Recent Issues')).toBeInTheDocument()
    expect(screen.getByText('First issue')).toBeInTheDocument()
    expect(screen.getByText('MUL-1')).toBeInTheDocument()
    expect(screen.getByText('Second issue')).toBeInTheDocument()
    expect(screen.getByText('MUL-2')).toBeInTheDocument()
  })

  it('filters out recent items not present in query cache', () => {
    mockRecentItems.current = [
      { id: 'issue-1', visitedAt: 1000 },
      { id: 'deleted-issue', visitedAt: 900 },
    ]
    mockAllIssues.current = [
      {
        id: 'issue-1',
        identifier: 'MUL-1',
        title: 'Existing issue',
        status: 'in_progress',
      },
    ]

    render(<SearchCommand />)

    expect(screen.getByText('Recent Issues')).toBeInTheDocument()
    expect(screen.getByText('Existing issue')).toBeInTheDocument()
    expect(screen.queryByText('deleted-issue')).not.toBeInTheDocument()
  })
})
