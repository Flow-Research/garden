import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberWithUser, User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { teamKeys } from '@/features/teams/queries'
import { workspaceKeys } from '@/lib/workspace/queries'
import { MembersTab } from './members-tab'

const api = vi.hoisted(() => ({
  createMember: vi.fn(),
  listMembers: vi.fn(),
  listWorkspaceInvitations: vi.fn(async () => []),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const OWNER = {
  id: 'member-1',
  workspace_id: 'ws-1',
  user_id: 'user-1',
  role: 'owner',
  created_at: '2026-01-01T00:00:00Z',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
} as MemberWithUser

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), [OWNER])
  queryClient.setQueryData(teamKeys.list('ws-1'), {
    teams: [],
    total: 0,
    unique_member_count: 0,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <MembersTab />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add a Team Member' }))
  return screen.getByRole('textbox', { name: 'Invitee 1 email' })
}

describe('MembersTab invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'user-1' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
  })

  it('sends one invitation when Enter is pressed twice', async () => {
    let finish: () => void = () => {}
    api.createMember.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    const email = renderTab()
    fireEvent.change(email, { target: { value: ' grace@example.com ' } })

    fireEvent.submit(email)
    fireEvent.submit(email)

    expect(api.createMember).toHaveBeenCalledTimes(1)
    expect(api.createMember).toHaveBeenCalledWith('ws-1', {
      email: 'grace@example.com',
      role: 'member',
    })
    finish()
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(toast.success).toHaveBeenCalledWith('Invitation sent')
  })

  it('sends nothing while any row has an invalid address', () => {
    const email = renderTab()
    fireEvent.change(email, { target: { value: 'grace@example.com' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Invitee 2 email' }), {
      target: { value: 'not-an-email' },
    })
    fireEvent.submit(email)

    expect(api.createMember).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid email address',
    )
  })

  it('locks invite edits during submission and lets the user retry a failed row', async () => {
    api.createMember
      .mockRejectedValueOnce(new Error('Please retry'))
      .mockResolvedValueOnce(undefined)
    const email = renderTab()
    const role = screen.getByRole('combobox', { name: 'Invitee 1 role' })
    const team = screen.getByRole('button', { name: 'Teams invitee 1 joins' })
    const remove = screen.getByRole('button', { name: 'Remove invitee 1' })
    const add = screen.getByRole('button', {
      name: /^Add a team member$/,
    })
    fireEvent.change(email, { target: { value: 'grace@example.com' } })
    fireEvent.submit(email)

    for (const control of [email, role, team, remove, add]) {
      expect(control).toBeDisabled()
    }

    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry')
    expect(email).toBeEnabled()
    expect(email).toHaveValue('grace@example.com')
    fireEvent.submit(email)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(api.createMember).toHaveBeenCalledTimes(2)
  })

  it('keeps only the rows that failed, with their error', async () => {
    api.createMember.mockImplementation(
      async (_ws: string, body: { email: string }) => {
        if (body.email === 'taken@example.com') {
          throw new Error('Already a member')
        }
      },
    )
    const email = renderTab()
    fireEvent.change(email, { target: { value: 'grace@example.com' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Invitee 2 email' }), {
      target: { value: 'taken@example.com' },
    })
    fireEvent.submit(email)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Already a member',
    )
    expect(api.createMember).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenCalledWith('Invitation sent')
    expect(
      screen.getByRole('textbox', { name: 'Invitee 1 email' }),
    ).toHaveValue('taken@example.com')
    expect(
      screen.queryByRole('textbox', { name: 'Invitee 2 email' }),
    ).not.toBeInTheDocument()
  })
})

describe('MembersTab GitHub identity controls', () => {
  const MEMBER = {
    ...OWNER,
    id: 'member-2',
    user_id: 'user-2',
    role: 'member',
    name: 'Grace',
    email: 'grace@example.com',
    github_user_id: null,
    github_login: null,
  } as MemberWithUser

  const ADMIN = {
    ...MEMBER,
    id: 'member-3',
    user_id: 'user-3',
    role: 'admin',
    name: 'Linus',
    email: 'linus@example.com',
  } as MemberWithUser

  function renderAs(
    viewerUserId: string,
    members: MemberWithUser[] = [OWNER, MEMBER],
  ) {
    useAuthStore.setState({ user: { id: viewerUserId } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(workspaceKeys.members('ws-1'), members)
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceIdProvider wsId="ws-1">
          <MembersTab />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )
  }

  it('gives a plain member no GitHub edit control, even on their own row', () => {
    renderAs('user-2')
    expect(
      screen.queryByRole('button', { name: /^Actions for / }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Link GitHub')).not.toBeInTheDocument()
  })

  it('lets an owner open Link GitHub on every row, their own included', async () => {
    renderAs('user-1')
    const triggers = screen.getAllByRole('button', { name: /^Actions for / })
    expect(triggers).toHaveLength(2)
    fireEvent.click(triggers[0]!)
    expect(
      await screen.findByRole('menuitem', { name: /link github/i }),
    ).toBeInTheDocument()
  })

  it("gives an admin no GitHub control on the owner's row", () => {
    renderAs('user-3', [OWNER, ADMIN, MEMBER])
    // Admin rows: own row and the member row; the owner row has no menu.
    expect(
      screen.getAllByRole('button', { name: /^Actions for / }),
    ).toHaveLength(2)
  })
})

describe('MembersTab GitHub menu visibility', () => {
  const person = (
    role: MemberWithUser['role'],
    github: { id: string; login: string } | null,
  ) =>
    ({
      ...OWNER,
      id: `member-${role}`,
      user_id: `user-${role}`,
      role,
      name: `The ${role}`,
      email: `${role}@example.com`,
      github_user_id: github?.id ?? null,
      github_login: github?.login ?? null,
    }) as MemberWithUser

  function renderFor(viewerRole: string, linked: boolean) {
    const github = linked ? { id: '1', login: 'octo' } : null
    useAuthStore.setState({ user: { id: `user-${viewerRole}` } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(workspaceKeys.members('ws-1'), [
      person('owner', github),
      person('admin', github),
      person('member', github),
    ])
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceIdProvider wsId="ws-1">
          <MembersTab />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )
  }

  // The API allows a link or unlink when the viewer is an owner or admin and
  // the target is not an owner, unless the viewer is an owner (own row too).
  const allowed = (viewer: string, target: string) =>
    (viewer === 'owner' || viewer === 'admin') &&
    (target !== 'owner' || viewer === 'owner')

  const cases = (['owner', 'admin', 'member'] as const).flatMap((viewer) =>
    (['owner', 'admin', 'member'] as const).map(
      (target) => [viewer, target] as const,
    ),
  )

  it.each(cases)('viewer %s on a linked %s row', async (viewer, target) => {
    renderFor(viewer, true)
    const trigger = screen.queryByRole('button', {
      name: `Actions for The ${target}`,
    })
    // A role change can be allowed where GitHub is not, so open any menu that
    // exists and look only at its GitHub items.
    if (trigger) {
      fireEvent.click(trigger)
      await screen.findAllByRole('menuitem')
    }
    const names = screen
      .queryAllByRole('menuitem', { name: /github/i })
      .map((item) => item.textContent?.trim())
    expect(names).toEqual(
      allowed(viewer, target) ? ['Edit GitHub identity', 'Unlink GitHub'] : [],
    )
  })

  it('offers Link GitHub but not Unlink when the member has no GitHub linked', async () => {
    renderFor('owner', false)
    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for The member' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: /link github/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /unlink github/i }),
    ).not.toBeInTheDocument()
  })
})
