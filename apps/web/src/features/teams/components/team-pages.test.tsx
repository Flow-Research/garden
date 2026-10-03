import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type { Team, TeamMember } from '@garden/core/types'
import { toast } from 'sonner'
import { TeamOverview } from './team-overview'
import { TeamDetail } from './team-detail'
import { TeamWorkPage } from './team-work-page'
import { AppSidebar } from '@garden/ui/components/shell/app-sidebar'
import {
  AddTeamMemberDialog,
  DeleteTeamDialog,
  TransferOwnerDialog,
} from './team-dialogs'

const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => (
    <div data-testid="navigate" data-to={to} />
  ),
  useNavigate: () => mockNavigate,
}))

vi.mock('@/features/layout/page-header', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))

vi.mock('@/features/issues/components/list-view', () => ({
  ListView: ({
    issues,
    variant,
  }: {
    issues: Array<{ id: string }>
    variant?: string
  }) => (
    <div data-testid="team-list" data-variant={variant ?? 'default'}>
      {issues.map((issue) => issue.id).join(',')}
    </div>
  ),
}))

vi.mock('@/features/issues/components/board-view', () => ({
  BoardView: ({ issues }: { issues: Array<{ id: string }> }) => (
    <div data-testid="team-board">
      {issues.map((issue) => issue.id).join(',')}
    </div>
  ),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), custom: vi.fn() },
}))

const apiMocks = vi.hoisted(() => ({
  listTeams: vi.fn(),
  createTeam: vi.fn(),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  transferTeamOwner: vi.fn(),
  listMembers: vi.fn(),
  listAgents: vi.fn(),
  listIssues: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMocks,
  getApi: () => apiMocks,
}))

const mockAuthUser = { id: 'user-1', email: 'owner@test.com', name: 'Owner' }

vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: (state: unknown) => unknown) => {
      const state = { user: mockAuthUser, isAuthenticated: true }
      return selector ? selector(state) : state
    },
    { getState: () => ({ user: mockAuthUser, isAuthenticated: true }) },
  ),
}))

vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: (state: unknown) => unknown) => {
      const state = { workspace: { id: 'ws-1', name: 'Test WS' } }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({ workspace: { id: 'ws-1', name: 'Test WS' } }),
    },
  ),
}))

vi.mock('@/features/workspace/workspace-avatar', () => ({
  WorkspaceAvatar: ({ name }: { name: string }) => (
    <span data-testid="workspace-avatar">{name.charAt(0)}</span>
  ),
}))

vi.mock('@/features/common/actor-avatar', () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => (
    <span data-testid={`avatar-${actorId}`} />
  ),
}))

vi.mock('@/features/modals/create-issue', () => ({
  CreateIssueModal: ({ data }: { data?: Record<string, unknown> | null }) => (
    <div data-testid="create-issue-modal">{JSON.stringify(data)}</div>
  ),
}))

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    workspace_id: 'ws-1',
    name: 'Engineering',
    description: 'Builds things',
    owner_user_id: 'user-1',
    created_by: 'user-1',
    member_count: 2,
    issue_count: 3,
    activity_count: 4,
    can_manage: true,
    can_transfer_owner: true,
    current_membership: {
      id: 'tm-1',
      member_type: 'user',
      user_id: 'user-1',
      agent_id: null,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'tm-1',
    team_id: 'team-1',
    workspace_id: 'ws-1',
    member_type: 'user',
    user_id: 'user-1',
    agent_id: null,
    name: 'Owner',
    email: 'owner@test.com',
    avatar_url: null,
    workspace_role: 'owner',
    agent_status: null,
    assigned_issue_count: 2,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceIdProvider wsId="ws-1">{ui}</WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('teams UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listAgents.mockResolvedValue([])
    apiMocks.listMembers.mockResolvedValue([
      {
        id: 'm-1',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        role: 'owner',
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-2',
        role: 'member',
        name: 'Casey',
        email: 'casey@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })
    apiMocks.listTeamMembers.mockResolvedValue({ members: [], total: 0 })
  })

  it('walks a manager through Team creation and submits the form', async () => {
    apiMocks.listTeams.mockResolvedValue({ teams: [], total: 0 })
    apiMocks.createTeam.mockResolvedValue(makeTeam())

    renderWithQuery(<TeamOverview />)

    expect(await screen.findByText('No Teams yet')).toBeInTheDocument()
    const createButtons = await screen.findAllByRole('button', {
      name: /Create a Team/,
    })
    fireEvent.click(createButtons[0] as HTMLElement)
    expect(await screen.findByText('Create New Team')).toBeInTheDocument()

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('e.g. Engineering'), {
      target: { value: 'Engineering' },
    })
    expect(continueButton).not.toBeDisabled()
    fireEvent.click(continueButton)

    expect(await screen.findByText('Team members')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect((await screen.findAllByText('Owner')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }))

    await waitFor(() => {
      expect(apiMocks.createTeam).toHaveBeenCalledWith({
        name: 'Engineering',
        description: null,
        initial_members: undefined,
      })
    })
    expect(toast.custom).toHaveBeenCalled()
  })

  it('hides management controls from normal members', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [makeTeam({ can_manage: false, can_transfer_owner: false })],
      total: 1,
    })
    apiMocks.listMembers.mockResolvedValue([
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        role: 'member',
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])

    renderWithQuery(<TeamOverview />)

    expect(await screen.findByText('Engineering')).toBeInTheDocument()
    expect(screen.queryByText('Create a Team')).not.toBeInTheDocument()
    expect(screen.queryByText('Manage Teams')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Teams')).not.toBeInTheDocument()
  })

  it('locks self-assignment for Team members creating issues', async () => {
    apiMocks.getTeam.mockResolvedValue(
      makeTeam({
        can_manage: false,
        can_transfer_owner: false,
        owner_user_id: 'user-9',
        current_membership: {
          id: 'tm-2',
          member_type: 'user',
          user_id: 'user-1',
          agent_id: null,
        },
      }),
    )
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember()],
      total: 1,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="issues" onTabChange={() => {}} />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Engineering' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Add a team member')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Team actions' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /New Issue/ }))
    const modal = await screen.findByTestId('create-issue-modal')
    expect(modal.textContent).toContain('"team_id":"team-1"')
    expect(modal.textContent).toContain('"lock_assignee_user_id":"user-1"')
  })

  it('adds a workspace user to the Team', async () => {
    apiMocks.addTeamMember.mockResolvedValue(makeMember())
    apiMocks.listMembers.mockResolvedValue([
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-2',
        role: 'member',
        name: 'Casey',
        email: 'casey@test.com',
        avatar_url: null,
      },
    ])

    renderWithQuery(
      <AddTeamMemberDialog
        teamId="team-1"
        existing={[makeMember()]}
        onClose={() => {}}
      />,
    )

    const radio = await screen.findByRole('radio')
    fireEvent.click(radio)
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => {
      expect(apiMocks.addTeamMember).toHaveBeenCalledWith('team-1', {
        member_type: 'user',
        user_id: 'user-2',
      })
    })
  })

  it('surfaces the linked-issue error when deleting a Team', async () => {
    apiMocks.deleteTeam.mockRejectedValue(new Error('Team has linked issues'))
    const onDeleted = vi.fn()
    const onClose = vi.fn()

    renderWithQuery(
      <DeleteTeamDialog
        team={makeTeam()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete Team' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Team has linked issues')
    })
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('transfers ownership to another human member', async () => {
    apiMocks.transferTeamOwner.mockResolvedValue(
      makeTeam({ owner_user_id: 'user-2' }),
    )

    renderWithQuery(
      <TransferOwnerDialog
        team={makeTeam()}
        members={[
          makeMember(),
          makeMember({
            id: 'tm-2',
            user_id: 'user-2',
            name: 'Casey',
            email: 'casey@test.com',
            workspace_role: 'member',
          }),
        ]}
        onClose={() => {}}
      />,
    )

    const radios = await screen.findAllByRole('radio')
    fireEvent.click(radios[1] as HTMLElement)
    fireEvent.click(
      screen.getByRole('button', { name: 'Transfer ownership' }),
    )

    await waitFor(() => {
      expect(apiMocks.transferTeamOwner).toHaveBeenCalledWith('team-1', {
        owner_user_id: 'user-2',
      })
    })
  })

  it('wires the admin summary actions', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [makeTeam()],
      total: 1,
    })

    renderWithQuery(<TeamOverview />)

    fireEvent.click(await screen.findByRole('button', { name: 'See issues' }))
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/teams/issues' })
    expect(
      screen.getByRole('button', { name: 'See members' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Manage Teams' }),
    ).toBeDisabled()
  })

  it('renders the Teams dropdown children and toggles them', () => {
    const onSelect = vi.fn()
    const onToggleExpand = vi.fn()
    render(
      <AppSidebar
        header={<span>Header</span>}
        items={[
          {
            id: 'teams',
            label: 'Teams',
            icon: ({ className }: { className?: string }) => (
              <span className={className} />
            ),
            children: [
              {
                id: 'teams-issues',
                label: 'Issues',
                icon: ({ className }: { className?: string }) => (
                  <span className={className} />
                ),
              },
              {
                id: 'teams-tasks',
                label: 'Tasks',
                icon: ({ className }: { className?: string }) => (
                  <span className={className} />
                ),
              },
            ],
          },
        ]}
        activeId="teams"
        activeChildId="teams-issues"
        expandedIds={['teams']}
        onToggleExpand={onToggleExpand}
        onSelect={onSelect}
        collapsed={false}
        userCard={<span>User</span>}
      />,
    )

    expect(screen.getByText('Issues')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Issues'))
    expect(onSelect).toHaveBeenCalledWith('teams-issues')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Teams' }))
    expect(onToggleExpand).toHaveBeenCalledWith('teams')
  })

  it('filters the admin work page by Team pill', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [
        makeTeam({ id: 'team-1', name: 'Engineering' }),
        makeTeam({ id: 'team-2', name: 'Finance', member_count: 1 }),
      ],
      total: 2,
    })
    apiMocks.listIssues.mockResolvedValue({
      issues: [
        { id: 'issue-1', team_id: 'team-1', status: 'todo' },
        { id: 'issue-2', team_id: 'team-2', status: 'in_progress' },
        { id: 'issue-3', team_id: null, status: 'todo' },
      ],
      total: 3,
    })

    renderWithQuery(<TeamWorkPage mode="tasks" />)

    expect(await screen.findByText('Total Tasks')).toBeInTheDocument()
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()
    expect(await screen.findByTestId('team-board')).toHaveTextContent('issue-1')

    fireEvent.click(screen.getByText('Finance'))
    await waitFor(() => {
      expect(screen.getByTestId('team-board')).toHaveTextContent('issue-2')
    })
  })

  it('redirects non-admins away from the admin work pages', async () => {
    apiMocks.listMembers.mockResolvedValue([
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        role: 'member',
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listTeams.mockResolvedValue({ teams: [], total: 0 })
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<TeamWorkPage mode="issues" />)

    const redirect = await screen.findByTestId('navigate')
    expect(redirect).toHaveAttribute('data-to', '/teams')
  })

  const caseyMember = makeMember({
    id: 'tm-2',
    user_id: 'user-2',
    name: 'Casey',
    email: 'casey@test.com',
    workspace_role: 'member',
    assigned_issue_count: 0,
  })

  it('renders the designed member table, summary cards and header actions', async () => {
    apiMocks.getTeam.mockResolvedValue(
      makeTeam({ activity_count: 7, member_count: 2 }),
    )
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember(), caseyMember],
      total: 2,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Engineering' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Builds things')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add a team member' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Owner: Owner' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Team actions' }),
    ).toBeInTheDocument()

    for (const header of ['User', 'Role', 'Assigned Tasks', 'Activity']) {
      expect(
        screen.getByRole('columnheader', { name: header }),
      ).toBeInTheDocument()
    }
    expect(screen.getByText('casey@test.com')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
    const viewAll = screen.getAllByRole('button', { name: 'View all' })
    expect(viewAll).toHaveLength(2)
    for (const button of viewAll) expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export Data' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Remove Owner' }),
    ).not.toBeInTheDocument()

    expect(screen.getByText('Total members')).toBeInTheDocument()
    expect(screen.getByText('Total Roles')).toBeInTheDocument()
    expect(screen.getByText('Total Activity')).toBeInTheDocument()
    expect(screen.getAllByText('02')).toHaveLength(2)
    expect(screen.getByText('07')).toBeInTheDocument()
  })

  it('shows a static owner display when transfer is not allowed', async () => {
    apiMocks.getTeam.mockResolvedValue(
      makeTeam({ can_transfer_owner: false }),
    )
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember()],
      total: 1,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    expect(await screen.findByText('Owner: Owner')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Owner: Owner' }),
    ).not.toBeInTheDocument()
  })

  it('filters members by search and role', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember(), caseyMember],
      total: 2,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    expect(await screen.findByText('casey@test.com')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search members'), {
      target: { value: 'casey' },
    })
    await waitFor(() => {
      expect(screen.queryByText('owner@test.com')).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Search members'), {
      target: { value: '' },
    })
    await waitFor(() => {
      expect(screen.getByText('owner@test.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: 'Member' }),
    )
    await waitFor(() => {
      expect(screen.queryByText('owner@test.com')).not.toBeInTheDocument()
    })
    expect(screen.getByText('casey@test.com')).toBeInTheDocument()
  })

  it('removes a non-owner member from the row action', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember(), caseyMember],
      total: 2,
    })
    apiMocks.removeTeamMember.mockResolvedValue(undefined)

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Casey' }),
    )
    await waitFor(() => {
      expect(apiMocks.removeTeamMember).toHaveBeenCalledWith('team-1', 'tm-2')
    })
    expect(toast.success).toHaveBeenCalledWith('Casey removed from the Team')
  })

  it('removes an agent member from its row action', async () => {
    const agentMember = makeMember({
      id: 'tm-3',
      member_type: 'agent',
      user_id: null,
      agent_id: 'agent-1',
      name: 'Garden',
      email: null,
      workspace_role: null,
      agent_status: 'active',
      assigned_issue_count: 0,
    })
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember(), agentMember],
      total: 2,
    })
    apiMocks.removeTeamMember.mockResolvedValue(undefined)

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Garden' }),
    )
    await waitFor(() => {
      expect(apiMocks.removeTeamMember).toHaveBeenCalledWith('team-1', 'tm-3')
    })
  })

  it('searches Team issues and shows status summaries from the toolbar', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember()],
      total: 1,
    })
    apiMocks.listIssues.mockResolvedValue({
      issues: [
        {
          id: 'issue-1',
          team_id: 'team-1',
          status: 'todo',
          identifier: 'ISS-1',
          title: 'Fix login',
          description: null,
        },
        {
          id: 'issue-2',
          team_id: 'team-1',
          status: 'todo',
          identifier: 'ISS-2',
          title: 'Write docs',
          description: null,
        },
      ],
      total: 2,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="issues" onTabChange={() => {}} />,
    )

    expect(await screen.findByTestId('team-list')).toHaveTextContent(
      'issue-1,issue-2',
    )
    expect(screen.getByTestId('team-list')).toHaveAttribute(
      'data-variant',
      'team',
    )
    expect(screen.getByText('Todo')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export Data' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /New Issue/ }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search issues'), {
      target: { value: 'login' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('team-list')).toHaveTextContent('issue-1')
    })
    expect(screen.getByTestId('team-list')).not.toHaveTextContent('issue-2')
  })
})
