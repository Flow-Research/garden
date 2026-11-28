import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { teamKeys } from '@/features/teams/queries'
import { workspaceKeys } from '@/lib/workspace/queries'
import { AppShell } from './app-shell'

const viewport = vi.hoisted(() => ({ mobile: false, navigate: vi.fn() }))
const createMember = vi.hoisted(() => vi.fn())

vi.mock('@garden/ui/hooks/use-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}))
vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>page</div>,
  useNavigate: () => viewport.navigate,
  useRouter: () => ({
    state: { matches: [{ fullPath: '/agents/$agentId' }] },
    invalidate: vi.fn(),
    clearCache: vi.fn(),
  }),
  useRouterState: ({ select }: { select: (state: object) => unknown }) =>
    select({ location: { pathname: '/home' }, matches: [] }),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api: new Proxy(
    {},
    {
      get: (_target, property) =>
        property === 'createMember'
          ? createMember
          : vi.fn(() => new Promise(() => {})),
    },
  ),
}))
vi.mock('@/features/settings', async () => ({
  InviteMembersDialog: (
    await import('@/features/settings/components/invite-members-dialog')
  ).InviteMembersDialog,
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
vi.mock('./workspace-menu', () => ({ WorkspaceMenu: () => null }))

function renderShell(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <AppShell />
      </WorkspaceIdProvider>
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
    const [inbox] = screen.getAllByRole('link', { name: /inbox/i })
    if (!inbox) throw new Error('no Inbox nav item')
    fireEvent.click(inbox)
    expect(viewport.navigate).toHaveBeenCalled()
    expect(drawer()).toHaveClass('-translate-x-full')
  })

  it('opens the Settings page from the account menu and closes the drawer', async () => {
    viewport.mobile = true
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    expect(viewport.navigate).toHaveBeenCalledWith({ to: '/settings' })
    expect(drawer()).toHaveClass('-translate-x-full')
  })
})

describe('AppShell invitations', () => {
  beforeEach(() => {
    viewport.mobile = false
    createMember.mockReset()
    useAuthStore.setState({ user: { id: 'user-1', name: 'Ada' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(workspaceKeys.members('ws-1'), [
      { user_id: 'user-1', role: 'owner' },
    ])
    queryClient.setQueryData(teamKeys.list('ws-1'), {
      teams: [],
      total: 0,
      unique_member_count: 0,
    })
    renderShell(queryClient)
  })

  async function openInvite() {
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Invite members' }),
    )
    return screen.getByRole('textbox', { name: 'Invitee 1 email' })
  }

  it.each(['Close', 'Cancel'])(
    'closes the current dialog with %s',
    async (name) => {
      await openInvite()
      fireEvent.click(screen.getByRole('button', { name }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('keeps a reopened dialog open when an earlier send completes', async () => {
    let finish: () => void = () => {}
    createMember.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    const firstEmail = await openInvite()
    fireEvent.change(firstEmail, { target: { value: 'grace@example.com' } })
    fireEvent.submit(firstEmail)
    expect(createMember).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    const reopenedEmail = await openInvite()
    fireEvent.change(reopenedEmail, { target: { value: 'linus@example.com' } })
    await act(async () => finish())

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(reopenedEmail).toHaveValue('linus@example.com')

    createMember.mockResolvedValueOnce(undefined)
    fireEvent.submit(reopenedEmail)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(createMember).toHaveBeenLastCalledWith('ws-1', {
      email: 'linus@example.com',
      role: 'member',
    })
  })
})

describe('AppShell nav links', () => {
  beforeEach(() => {
    viewport.mobile = false
    viewport.navigate.mockClear()
    useAuthStore.setState({ user: { id: 'user-1', name: 'Ada' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
  })

  it('renders nav items as links that open in a new tab', () => {
    renderShell()
    const inbox = screen.getByRole('link', { name: /inbox/i })
    expect(inbox).toHaveAttribute('href', '/inbox')

    // A modified click is left to the browser (new tab), not routed in-app.
    fireEvent.click(inbox, { metaKey: true })
    expect(viewport.navigate).not.toHaveBeenCalled()

    fireEvent.click(inbox)
    expect(viewport.navigate).toHaveBeenCalledWith({ to: '/inbox' })
  })
})

it('finishes leaving the item page before it changes workspace', async () => {
  const next = { id: 'new', name: 'New team' } as Workspace
  const client = new QueryClient()
  client.setQueryData(workspaceKeys.list(), [next])
  const switchWorkspace = vi.fn().mockResolvedValue(undefined)
  const original = useWorkspaceStore.getState().switchWorkspace
  useAuthStore.setState({ user: { id: 'user-1', name: 'Ada' } as User })
  useWorkspaceStore.setState({
    workspace: { id: 'old', name: 'Old' } as Workspace,
    switchWorkspace,
  })
  let finishNavigation: () => void = () => {}
  viewport.navigate.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishNavigation = resolve
    }),
  )
  try {
    renderShell(client)
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Workspaces' }))
    fireEvent.click(await screen.findByRole('button', { name: next.name }))
    expect(viewport.navigate).toHaveBeenCalledWith({ href: '/agents' })
    expect(switchWorkspace).not.toHaveBeenCalled()
    await act(async () => finishNavigation())
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith(next))
  } finally {
    useWorkspaceStore.setState({ switchWorkspace: original })
    client.clear()
  }
})

it('closes the invite dialog on workspace change and discards the prior invitation', async () => {
  const first = { id: 'north', name: 'North' } as Workspace
  const second = { id: 'south', name: 'South' } as Workspace
  const client = new QueryClient()
  client.setQueryData(workspaceKeys.members(first.id), [
    { user_id: 'inviter', role: 'owner' },
  ])
  client.setQueryData(workspaceKeys.members(second.id), [
    { user_id: 'inviter', role: 'member' },
  ])
  useAuthStore.setState({ user: { id: 'inviter', name: 'Inviter' } as User })
  useWorkspaceStore.setState({ workspace: first })
  renderShell(client)
  fireEvent.click(screen.getByRole('button', { name: 'Account' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Invite members' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  act(() => useWorkspaceStore.setState({ workspace: second }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Account' }))
  expect(screen.queryByRole('button', { name: 'Invite members' })).toBeNull()
  act(() => useWorkspaceStore.setState({ workspace: first }))
  expect(screen.queryByRole('dialog')).toBeNull()
  client.clear()
})
