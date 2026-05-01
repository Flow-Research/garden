import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetOpen = vi.hoisted(() => vi.fn())
const mockOpenPanel = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())
const mockQueryClear = vi.hoisted(() => vi.fn())
const mockCreateSession = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ id: 'session-new', title: 'New Chat' }),
}))
const mockClaimWarmSession = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'session-new', title: 'New Chat' }),
)
const mockSetActiveSession = vi.hoisted(() => vi.fn())

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
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ clear: mockQueryClear }),
}))

vi.mock('@garden/core/inbox/queries', () => ({
  deduplicateInboxItems: (items: unknown[]) => items,
  inboxListOptions: () => ({ queryKey: ['inbox'], queryFn: vi.fn() }),
}))

vi.mock('@garden/core/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: (state: typeof mockAuthState) => unknown) =>
      selector ? selector(mockAuthState) : mockAuthState,
    {
      getState: () => mockAuthState,
    },
  ),
}))

vi.mock('@garden/core/workspace', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: (state: typeof mockWorkspaceState) => unknown) =>
      selector ? selector(mockWorkspaceState) : mockWorkspaceState,
    {
      getState: () => mockWorkspaceState,
    },
  ),
}))

vi.mock('@garden/core/chat', () => ({
  useChatStore: Object.assign(
    (selector?: (state: { activeSessionId: string | null; setActiveSession: typeof mockSetActiveSession }) => unknown) => {
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

vi.mock('@garden/ui/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    replace: mockReplace,
  }),
}))

vi.mock('@/components/nav-user', () => ({
  NavUser: () => <div>Nav user</div>,
}))

vi.mock('./workspace-dock', () => ({
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
  })

  it('switches explorer content from the selected rail context', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<WorkspaceSidebar />)

    expect(screen.getByRole('button', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inbox/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chats/i }))

    // Clicking a rail icon must NOT toggle the sidebar's open state — the
    // user's explicit collapse should be respected when they switch contexts.
    expect(mockSetOpen).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockClaimWarmSession).toHaveBeenCalled()
    })
    expect(mockOpenPanel).toHaveBeenCalledWith({
      kind: 'chat',
      title: 'New Chat',
      entityId: 'session-new',
    })
    expect(screen.getByRole('button', { name: /dashboard/i })).toBeInTheDocument()
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

  it('keeps the explorer synced with the active screen', async () => {
    mockDockState.activePanel = {
      kind: 'chat',
      title: 'New Chat',
      entityId: undefined,
    }

    const { rerender } = render(<WorkspaceSidebar />)

    await waitFor(() => {
      expect(screen.getByText('Chat session explorer')).toBeInTheDocument()
    })

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

  it('does not render an agent rail entry', () => {
    render(<WorkspaceSidebar />)

    expect(
      screen.queryByRole('button', { name: /^agent$/i }),
    ).not.toBeInTheDocument()
  })
})
