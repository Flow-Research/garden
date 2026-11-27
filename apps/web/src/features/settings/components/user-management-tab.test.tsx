import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemberWithUser,
  Team,
  TeamSummary,
  User,
} from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { teamKeys } from '@/features/teams/queries'
import { workspaceKeys } from '@/lib/workspace/queries'
import {
  UserManagementMembers,
  UserManagementTeamDetail,
  UserManagementTeams,
} from './user-management-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode
    to: string
    params?: { teamId?: string }
  }) => (
    <a href={params?.teamId ? to.replace('$teamId', params.teamId) : to}>
      {children}
    </a>
  ),
  Navigate: ({ to }: { to: string }) => (
    <div data-testid="navigate" data-to={to} />
  ),
  useNavigate: () => vi.fn(),
}))
vi.mock('./members-tab', () => ({
  MembersTab: ({ toolbar }: { toolbar?: React.ReactNode }) => (
    <>
      {toolbar}
      <h2>Members content</h2>
    </>
  ),
}))
vi.mock('@/features/teams/components/team-detail', () => ({
  TeamDetailCard: ({
    teamId,
    tab,
    showTabs,
  }: {
    teamId: string
    tab: string
    showTabs?: boolean
  }) => (
    <h2>
      Team card {teamId} {tab}{' '}
      {showTabs === false ? 'without tabs' : 'with tabs'}
    </h2>
  ),
}))
const api = vi.hoisted(() => ({ listMembers: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

function member(role: MemberWithUser['role']) {
  return {
    id: 'member-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    role,
    created_at: '2026-01-01T00:00:00Z',
    name: 'Ada',
    email: 'ada@example.com',
    avatar_url: null,
  } as MemberWithUser
}

const TEAM = {
  id: 'team-1',
  name: 'Platform',
  description: 'Runs the platform',
  member_count: 3,
  can_manage: true,
  can_transfer_owner: true,
} as TeamSummary

/** `role: null` leaves the members query loading, as on a cold reload. */
function renderWithRole(role: MemberWithUser['role'] | null, ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (role) {
    queryClient.setQueryData(workspaceKeys.members('ws-1'), [member(role)])
  }
  queryClient.setQueryData(teamKeys.list('ws-1'), {
    teams: [TEAM],
    total: 1,
    unique_member_count: 3,
  })
  const detail: Team = { ...TEAM, created_by: 'user-1', activity_count: 0 }
  queryClient.setQueryData(teamKeys.detail('ws-1', TEAM.id), detail)
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">{ui}</WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('User Management', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1' } as User })
  })

  it('gives admins Members and Team sub-tab links', () => {
    renderWithRole('admin', <UserManagementMembers />)
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/settings/user-management/members',
    )
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute(
      'href',
      '/settings/user-management/teams',
    )
    expect(
      screen.getByRole('heading', { name: 'Members content' }),
    ).toBeVisible()
  })

  it('shows members the member list without sub-tabs', () => {
    renderWithRole('member', <UserManagementMembers />)
    expect(
      screen.getByRole('heading', { name: 'Members content' }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
  })

  it('opens Team cards in Settings', async () => {
    renderWithRole('owner', <UserManagementTeams />)
    expect(
      await screen.findByRole('button', { name: 'Create a Team' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Platform' })).toHaveAttribute(
      'href',
      '/settings/user-management/teams/team-1',
    )
    expect(screen.getByText('3 members')).toBeVisible()
    expect(screen.queryByText('Default team for new members')).toBeNull()
  })

  it('holds the Team skeleton while the role loads on reload', () => {
    api.listMembers.mockReturnValue(new Promise(() => {}))
    renderWithRole(null, <UserManagementTeams />)
    expect(screen.getByLabelText('Loading teams')).toBeVisible()
    expect(screen.queryByTestId('navigate')).toBeNull()
  })

  it('sends members from Team pages to Members', () => {
    renderWithRole('member', <UserManagementTeams />)
    expect(screen.getByTestId('navigate')).toHaveAttribute(
      'data-to',
      '/settings/user-management/members',
    )
    expect(screen.queryByRole('button', { name: 'Create a Team' })).toBeNull()
  })

  it('shows the Team detail card under a Teams breadcrumb', () => {
    renderWithRole('admin', <UserManagementTeamDetail teamId="team-1" />)
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(breadcrumb).toHaveTextContent('Teams/Platform')
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'href',
      '/settings/user-management/teams',
    )
    expect(
      screen.getByRole('heading', {
        name: 'Team card team-1 members without tabs',
      }),
    ).toBeVisible()
  })

  it('sends members from Team detail to Members', () => {
    renderWithRole('member', <UserManagementTeamDetail teamId="team-1" />)
    expect(screen.getByTestId('navigate')).toHaveAttribute(
      'data-to',
      '/settings/user-management/members',
    )
  })
})
