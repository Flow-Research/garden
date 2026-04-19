import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetOpen = vi.hoisted(() => vi.fn())
const mockOpenPanel = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())
const mockQueryClear = vi.hoisted(() => vi.fn())

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

vi.mock('@accelerate/core/inbox/queries', () => ({
  deduplicateInboxItems: (items: unknown[]) => items,
  inboxListOptions: () => ({ queryKey: ['inbox'], queryFn: vi.fn() }),
}))

vi.mock('@accelerate/core/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: (state: typeof mockAuthState) => unknown) =>
      selector ? selector(mockAuthState) : mockAuthState,
    {
      getState: () => mockAuthState,
    },
  ),
}))

vi.mock('@accelerate/core/workspace', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: (state: typeof mockWorkspaceState) => unknown) =>
      selector ? selector(mockWorkspaceState) : mockWorkspaceState,
    {
      getState: () => mockWorkspaceState,
    },
  ),
}))

vi.mock('@accelerate/ui/components/ui/sidebar', () => ({
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
  }: {
    children: ReactNode
    isActive?: boolean
    onClick?: () => void
  }) => (
    <button
      type="button"
      data-active={isActive ? 'true' : 'false'}
      onClick={onClick}
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

vi.mock('@accelerate/ui/components/common/brand-icon', () => ({
  BrandIcon: () => <span>Logo</span>,
}))

vi.mock('@accelerate/ui/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(' '),
}))

vi.mock('@/features/search', () => ({
  SearchTrigger: () => <button type="button">Search</button>,
}))

vi.mock('@/features/chat', () => ({
  ChatSessionExplorer: () => <div>Chat session explorer</div>,
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

    expect(screen.getByText('No active work yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chats/i }))

    expect(mockSetOpen).toHaveBeenCalledWith(true)
    expect(mockOpenPanel).toHaveBeenCalledWith({
      kind: 'chat',
      title: 'New Chat',
    })
    expect(screen.getByText('No active work yet.')).toBeInTheDocument()
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
      expect(screen.getByText('No active work yet.')).toBeInTheDocument()
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
