import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Agent, TeamMember } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { AssigneePicker } from './assignee-picker'

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listAgents: vi.fn(),
  listFrequencies: vi.fn(),
  listTeamMembers: vi.fn(),
}))

vi.mock('@/lib/workspace/queries', () => ({
  memberListOptions: () => ({
    queryKey: ['ws-members'],
    queryFn: mocks.listMembers,
  }),
  agentListOptions: () => ({
    queryKey: ['ws-agents'],
    queryFn: mocks.listAgents,
  }),
  assigneeFrequencyOptions: () => ({
    queryKey: ['ws-freq'],
    queryFn: mocks.listFrequencies,
  }),
}))

vi.mock('@/features/teams/queries', () => ({
  teamMemberListOptions: (_wsId: string, teamId: string) => ({
    queryKey: ['team-members', teamId],
    queryFn: () => mocks.listTeamMembers(teamId),
  }),
}))

vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/workspace/hooks', () => ({
  useActorName: () => ({
    getActorName: (_type: string, id: string) => id,
    getActorInitials: () => 'AA',
    getActorAvatarUrl: () => null,
  }),
}))

function makeTeamMember(overrides: Partial<TeamMember>): TeamMember {
  return {
    id: 'tm-x',
    team_id: 'team-1',
    workspace_id: 'ws-1',
    member_type: 'user',
    user_id: null,
    agent_id: null,
    name: 'Member',
    email: null,
    avatar_url: null,
    workspace_role: 'member',
    agent_status: null,
    assigned_issue_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const TEAM_MEMBERS: TeamMember[] = [
  makeTeamMember({
    id: 'tm-1',
    user_id: 'user-1',
    name: 'Ada Lovelace',
    workspace_role: 'owner',
  }),
  makeTeamMember({ id: 'tm-2', user_id: 'user-2', name: 'Bob Member' }),
  makeTeamMember({
    id: 'tm-3',
    member_type: 'agent',
    agent_id: 'agent-1',
    name: 'Garden Agent',
    workspace_role: null,
    agent_status: 'active',
  }),
  makeTeamMember({
    id: 'tm-4',
    member_type: 'agent',
    agent_id: 'agent-2',
    name: 'Archived Agent',
    workspace_role: null,
    agent_status: 'archived',
  }),
]

const WORKSPACE_MEMBERS = [
  {
    id: 'm-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    role: 'owner',
    created_at: '2026-01-01T00:00:00.000Z',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatar_url: null,
  },
  {
    id: 'm-2',
    workspace_id: 'ws-1',
    user_id: 'user-9',
    role: 'member',
    created_at: '2026-01-01T00:00:00.000Z',
    name: 'Outside Member',
    email: 'outside@example.com',
    avatar_url: null,
  },
]

const WORKSPACE_AGENTS = [
  {
    id: 'agent-1',
    name: 'Garden Agent',
    archived_at: null,
    visibility: 'workspace',
    owner_id: null,
  },
] as unknown as Agent[]

function renderPicker(teamId: string | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceIdProvider wsId="ws-1">
        <AssigneePicker
          assigneeId={null}
          assigneeType={null}
          onOpenChange={() => {}}
          onUpdate={() => {}}
          open
          teamId={teamId}
        />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('AssigneePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listFrequencies.mockResolvedValue([])
    mocks.listMembers.mockResolvedValue(WORKSPACE_MEMBERS)
    mocks.listAgents.mockResolvedValue(WORKSPACE_AGENTS)
    mocks.listTeamMembers.mockResolvedValue(TEAM_MEMBERS)
  })

  it('lists only Team members for a Team-scoped issue', async () => {
    renderPicker('team-1')

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Bob Member')).toBeTruthy()
    expect(screen.getByText('Garden Agent')).toBeTruthy()
    // Archived agents are not assignable, workspace outsiders are not members.
    expect(screen.queryByText('Archived Agent')).toBeNull()
    expect(screen.queryByText('Outside Member')).toBeNull()
    // Team issues must always carry a Team member assignee.
    expect(screen.queryByText('Unassigned')).toBeNull()
    expect(mocks.listTeamMembers).toHaveBeenCalledWith('team-1')
    expect(mocks.listMembers).not.toHaveBeenCalled()
    expect(mocks.listAgents).not.toHaveBeenCalled()
  })

  it('keeps the workspace-wide list and Unassigned for workspace issues', async () => {
    renderPicker(null)

    expect(await screen.findByText('Outside Member')).toBeTruthy()
    expect(screen.getByText('Garden Agent')).toBeTruthy()
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0)
    expect(mocks.listTeamMembers).not.toHaveBeenCalled()
  })
})
