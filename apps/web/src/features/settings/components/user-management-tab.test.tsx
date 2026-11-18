import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberWithUser, TeamSummary, User } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { teamKeys } from '@/features/teams/queries'
import { workspaceKeys } from '@/lib/workspace/queries'
import {
  UserManagementTab,
  type UserManagementView,
} from './user-management-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    search,
  }: {
    children: React.ReactNode
    search?: { view?: string }
  }) => <a href={`?view=${search?.view ?? 'members'}`}>{children}</a>,
}))
vi.mock('./members-tab', () => ({
  MembersTab: () => <h2>Members content</h2>,
}))
const api = vi.hoisted(() => ({
  getWorkspaceTeamSettings: vi.fn(async () => ({
    team_owners_can_invite: false,
    default_invite_team_id: null,
  })),
}))
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

function renderTab(role: MemberWithUser['role'], view: UserManagementView) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), [member(role)])
  queryClient.setQueryData(teamKeys.list('ws-1'), {
    teams: [TEAM],
    total: 1,
    unique_member_count: 3,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <UserManagementTab view={view} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('UserManagementTab', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1' } as User })
  })

  it('gives admins Members and Team sub-tabs', () => {
    renderTab('admin', 'members')
    expect(screen.getByRole('link', { name: 'Members' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Team' })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Members content' }),
    ).toBeVisible()
  })

  it('shows Team management on the Team sub-tab', async () => {
    renderTab('owner', 'team')
    expect(
      await screen.findByRole('button', { name: 'Create a Team' }),
    ).toBeVisible()
    expect(screen.getByText('Platform')).toBeVisible()
    expect(screen.getByText('3 members')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Members content' }),
    ).toBeNull()
  })

  it('keeps members on the member list without Team management', () => {
    renderTab('member', 'team')
    expect(
      screen.getByRole('heading', { name: 'Members content' }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create a Team' })).toBeNull()
  })
})
