import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { AppShell } from './app-shell'

const viewport = vi.hoisted(() => ({ mobile: false, navigate: vi.fn() }))

vi.mock('@garden/ui/hooks/use-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}))
vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>page</div>,
  useNavigate: () => viewport.navigate,
  useRouter: () => ({ invalidate: vi.fn(), clearCache: vi.fn() }),
  useRouterState: ({ select }: { select: (state: object) => unknown }) =>
    select({ location: { pathname: '/home' }, matches: [] }),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api: new Proxy({}, { get: () => vi.fn(() => new Promise(() => {})) }),
}))
vi.mock('@/features/settings', () => ({
  SettingsDialog: () => null,
  useSettingsDialogStore: (select: (state: object) => unknown) =>
    select({ openSettings: vi.fn() }),
}))
vi.mock('@/features/search', () => ({ SearchCommand: () => null }))
vi.mock('@/features/chat/chat-runtime-provider', () => ({
  ChatRuntimeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@/features/modals/create-workspace', () => ({
  CreateWorkspaceModal: () => null,
}))
vi.mock('@/features/navigation/use-surface-navigation', () => ({
  useSurfaceNavigation: () => ({
    openIssue: vi.fn(),
    openChatSession: vi.fn(),
  }),
}))
vi.mock('./chat-tabs', () => ({ ChatTabsStrip: () => null }))
vi.mock('./task-tabs', () => ({ TaskTabsStrip: () => null }))
vi.mock('./user-card', () => ({ UserCard: () => null }))
vi.mock('./workspace-menu', () => ({ WorkspaceMenu: () => null }))

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell />
    </QueryClientProvider>,
  )
}

const sidebar = () => screen.getByRole('complementary', { name: 'Primary' })
const drawer = () => sidebar().parentElement as HTMLElement

describe('AppShell sidebar', () => {
  beforeEach(() => {
    viewport.navigate.mockClear()
    useAuthStore.setState({ user: { id: 'user-1', name: 'Ada' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
  })

  it('keeps the sidebar in the layout on wide screens', () => {
    viewport.mobile = false
    renderShell()
    expect(drawer()).toHaveClass('contents')
    expect(drawer()).not.toHaveAttribute('inert')
  })

  it('is a closed drawer on small screens, opened by the sidebar toggle', () => {
    viewport.mobile = true
    renderShell()

    expect(drawer()).toHaveClass('-translate-x-full')
    expect(drawer()).toHaveAttribute('inert')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(drawer()).toHaveClass('translate-x-0')
    expect(drawer()).not.toHaveAttribute('inert')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawer()).toHaveClass('-translate-x-full')
  })

  it('closes the drawer from the backdrop and after navigating', () => {
    viewport.mobile = true
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(drawer()).toHaveClass('-translate-x-full')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    const [inbox] = screen.getAllByRole('button', { name: /inbox/i })
    if (!inbox) throw new Error('no Inbox nav item')
    fireEvent.click(inbox)
    expect(viewport.navigate).toHaveBeenCalled()
    expect(drawer()).toHaveClass('-translate-x-full')
  })
})
