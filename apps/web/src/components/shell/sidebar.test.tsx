import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetOpen = vi.hoisted(() => vi.fn())
const mockSidebarState = vi.hoisted(() => ({
  open: true,
}))
const mockOpenPanel = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())
const mockInvalidateQueries = vi.hoisted(() => vi.fn())
const mockQueryClear = vi.hoisted(() => vi.fn())
const mockNavigationState = vi.hoisted(() => ({
  pathname: '/workspace',
  searchParams: new URLSearchParams('workspace_id=workspace-1&issue=issue-1'),
}))
const mockCreateSession = vi.hoisted(() => ({
  mutateAsync: vi
    .fn()
    .mockResolvedValue({ id: 'session-new', title: 'New Chat' }),
}))
const mockClaimWarmSession = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'session-new', title: 'New Chat' }),
)
const mockDockState = vi.hoisted(() => ({
  activePanel: {
    kind: 'inbox',
    title: 'Inbox',
    entityId: undefined,
  } as { kind: string; title: string; entityId?: string },
  openPanel: mockOpenPanel,
}))

const mockWorkspaceState = vi.hoisted(() => ({
  workspace: { id: 'workspace-1', name: 'Acme' },
  clearWorkspace: vi.fn(),
  switchWorkspace: vi.fn().mockResolvedValue(undefined),
}))

const mockAuthState = vi.hoisted(() => ({
  user: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatar_url: null,
  },
  logout: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({
    clear: mockQueryClear,
    invalidateQueries: mockInvalidateQueries,
    prefetchQuery: vi.fn(),
  }),
}))

vi.mock('@/lib/inbox/queries', () => ({
  deduplicateInboxItems: (items: unknown[]) => items,
  inboxListOptions: () => ({ queryKey: ['inbox'], queryFn: vi.fn() }),
}))

vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: (state: typeof mockAuthState) => unknown) =>
      selector ? selector(mockAuthState) : mockAuthState,
    {
      getState: () => mockAuthState,
    },
  ),
}))

vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: (state: typeof mockWorkspaceState) => unknown) =>
      selector ? selector(mockWorkspaceState) : mockWorkspaceState,
    {
      getState: () => mockWorkspaceState,
    },
  ),
}))

vi.mock('@garden/ui/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuBadge: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  SidebarMenuButton: ({
    children,
    isActive,
    onClick,
    ...props
  }: {
    children: ReactNode
    isActive?: boolean
    onClick?: () => void
  } & Record<string, unknown>) => (
    <button
      type="button"
      data-active={isActive ? 'true' : 'false'}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useSidebar: () => ({
    open: mockSidebarState.open,
    setOpen: mockSetOpen,
  }),
}))

vi.mock('@garden/ui/components/common/brand-icon', () => ({
  BrandIcon: () => <span>Logo</span>,
}))

vi.mock('@garden/ui/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(' '),
}))

vi.mock('@/features/search', () => ({
  SearchTrigger: () => <button type="button">Search</button>,
}))

vi.mock('@/features/chat', () => ({
  ChatSessionExplorer: () => <div>Chat session explorer</div>,
}))

vi.mock('@/features/chat/use-agent-chat-sessions', () => ({
  useAgentSessions: () => ({
    createSession: mockCreateSession,
    claimWarmSession: mockClaimWarmSession,
    sessions: [],
  }),
}))

vi.mock('@/features/navigation', () => ({
  useNavigation: () => ({
    pathname: mockNavigationState.pathname,
    replace: mockReplace,
    searchParams: mockNavigationState.searchParams,
  }),
}))

vi.mock('@/components/nav-user', () => ({
  NavUser: ({
    onSwitchWorkspace,
  }: {
    onSwitchWorkspace: (workspace: { id: string; name: string }) => void
  }) => (
    <button
      type="button"
      onClick={() => onSwitchWorkspace({ id: 'workspace-2', name: 'Research' })}
    >
      Switch workspace
    </button>
  ),
}))

vi.mock('./workspace-dock', () => ({
  getRailContextForPanel: (kind: string | null | undefined) => {
    switch (kind) {
      case 'chat':
        return 'chats'
      case 'issues':
      case 'issue-detail':
        return 'tasks'
      case 'automations':
      case 'automation-detail':
        return 'automations'
      case 'inbox':
        return 'inbox'
      case 'agents':
      case 'agent-detail':
        return 'agents'
      case 'skill-editor':
        return 'skills'
      case 'capabilities':
        return 'connections'
      default:
        return 'home'
    }
  },
  railUsesContextRail: (rail: string) =>
    rail === 'home' ||
    rail === 'chats' ||
    rail === 'skills' ||
    rail === 'agents' ||
    rail === 'connections',
  useWorkspaceDock: () => mockDockState,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { WorkspaceSidebar } from './sidebar'

describe('WorkspaceSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDockState.activePanel = {
      kind: 'inbox',
      title: 'Inbox',
      entityId: undefined,
    }
    mockSidebarState.open = true
    mockNavigationState.pathname = '/workspace'
    mockNavigationState.searchParams = new URLSearchParams(
      'workspace_id=workspace-1&issue=issue-1',
    )
    mockWorkspaceState.switchWorkspace.mockResolvedValue(undefined)
  })

  it('switches explorer content from the selected rail context', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<WorkspaceSidebar />)

    expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inbox/i })).toBeInTheDocument()
    expect(screen.queryByText('Chat session explorer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chats/i }))

    await waitFor(() => {
      expect(mockClaimWarmSession).toHaveBeenCalled()
    })
    expect(mockOpenPanel).toHaveBeenCalledWith({
      kind: 'chat',
      title: 'New Chat',
      entityId: 'session-new',
    })
    expect(screen.queryByText('Chat session explorer')).not.toBeInTheDocument()

    mockDockState.activePanel = {
      kind: 'chat',
      title: 'New Chat',
      entityId: undefined,
    }

    rerender(<WorkspaceSidebar />)

    await waitFor(() => {
      expect(screen.getByText('Chat session explorer')).toBeInTheDocument()
    })
    expect(screen.queryByText('No active work yet.')).not.toBeInTheDocument()
  })

  it('hides the explorer immediately when switching to a no-explorer rail item', async () => {
    mockDockState.activePanel = {
      kind: 'chat',
      title: 'New Chat',
      entityId: undefined,
    }

    const { rerender } = render(<WorkspaceSidebar />)

    await waitFor(() => {
      expect(screen.getByText('Chat session explorer')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /inbox/i }))

    expect(screen.queryByText('Chat session explorer')).not.toBeInTheDocument()
    expect(mockSetOpen).toHaveBeenCalledWith(false)

    mockDockState.activePanel = {
      kind: 'inbox',
      title: 'Inbox',
      entityId: undefined,
    }

    rerender(<WorkspaceSidebar />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument()
    })
    expect(screen.queryByText('Chat session explorer')).not.toBeInTheDocument()
  })

  it('reopens a collapsed context rail without showing stale explorer content', async () => {
    mockSidebarState.open = false
    const user = userEvent.setup()

    const { rerender } = render(<WorkspaceSidebar />)

    await user.click(screen.getByRole('button', { name: /chats/i }))

    expect(screen.queryByText('Chat session explorer')).not.toBeInTheDocument()
    expect(mockSetOpen).toHaveBeenCalledWith(true)

    mockDockState.activePanel = {
      kind: 'chat',
      title: 'New Chat',
      entityId: undefined,
    }

    rerender(<WorkspaceSidebar />)

    expect(screen.getByText('Chat session explorer')).toBeInTheDocument()
  })

  it('removes a consumed workspace deep link after switching workspaces', async () => {
    render(<WorkspaceSidebar />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch workspace' }),
    )

    await waitFor(() => {
      expect(mockWorkspaceState.switchWorkspace).toHaveBeenCalledWith({
        id: 'workspace-2',
        name: 'Research',
      })
    })
    expect(mockReplace).toHaveBeenCalledWith('/workspace?issue=issue-1')
    expect(mockInvalidateQueries).toHaveBeenCalled()
  })

  it('does not render an agent rail entry', () => {
    render(<WorkspaceSidebar />)

    expect(
      screen.queryByRole('button', { name: /^agent$/i }),
    ).not.toBeInTheDocument()
  })
})
