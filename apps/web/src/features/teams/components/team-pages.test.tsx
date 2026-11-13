import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type { Team, TeamMember } from '@garden/core/types'
import { toast } from 'sonner'
import { TeamOverview } from './team-overview'
import { TeamDetail, membersToCsv } from './team-detail'
import { TeamWorkPage } from './team-work-page'
import { teamIssueViewStore } from '../view-store'
import { AppSidebar } from '@garden/ui/components/shell/app-sidebar'
import {
  AddTeamMemberDialog,
  DeleteTeamDialog,
  TransferOwnerPopover,
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
  useSearch: () => ({}),
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
  getTeamAgentPolicy: vi.fn(),
  updateTeamAgentPolicy: vi.fn(),
  listMembers: vi.fn(),
  listAgents: vi.fn(),
  listIssues: vi.fn(),
  listProjects: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMocks,
  getApi: () => apiMocks,
  listConnections: () => Promise.resolve({ integrations: [] }),
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
        github_user_id: null,
        github_login: null,
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-2',
        role: 'member',
        github_user_id: null,
        github_login: null,
        name: 'Casey',
        email: 'casey@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })
    apiMocks.listProjects.mockResolvedValue({ projects: [] })
    apiMocks.listTeamMembers.mockResolvedValue({ members: [], total: 0 })
    // The team issues view store is module-level and persisted; pin the view
    // mode so list/board assertions are deterministic across tests.
    teamIssueViewStore.setState({ viewMode: 'list' })
  })

  it('walks a manager through Team creation and submits the form', async () => {
    apiMocks.listTeams.mockResolvedValue({ teams: [], total: 0 })
    apiMocks.createTeam.mockResolvedValue(makeTeam())

    renderWithQuery(<TeamOverview />)

    expect(await screen.findByText('No Teams')).toBeInTheDocument()
    const createButtons = await screen.findAllByRole('button', {
      name: /Create a Team/,
    })
    fireEvent.click(createButtons[0] as HTMLElement)
    expect(await screen.findByText('Create New Team')).toBeInTheDocument()

    expect(
      screen.getByText('Setup and add team members to your team'),
    ).toBeInTheDocument()
    const createButton = screen.getByRole('button', { name: 'Create team' })
    expect(createButton).toBeDisabled()

    fireEvent.change(
      screen.getByPlaceholderText('Enter the name of your team'),
      { target: { value: 'Engineering' } },
    )
    expect(createButton).not.toBeDisabled()

    // The creator is never listed; the counter tracks picked members.
    expect(await screen.findByText('No select')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Owner' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Casey' }))
    expect(screen.getByText('1 select')).toBeInTheDocument()

    fireEvent.click(createButton)

    await waitFor(() => {
      expect(apiMocks.createTeam).toHaveBeenCalledWith({
        name: 'Engineering',
        description: null,
        initial_members: [{ member_type: 'user', user_id: 'user-2' }],
      })
    })
    expect(toast.custom).toHaveBeenCalled()
  })

  it('shows the create dialog empty state when nobody else can join', async () => {
    apiMocks.listTeams.mockResolvedValue({ teams: [], total: 0 })
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
    ])

    renderWithQuery(<TeamOverview />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create a Team' }),
    )
    expect(await screen.findByText('No team member')).toBeInTheDocument()
    expect(
      screen.getByText('Add team members to see them here'),
    ).toBeInTheDocument()
  })

  it('shows an error with retry when the members query fails on overview', async () => {
    apiMocks.listTeams.mockResolvedValue({ teams: [], total: 0 })
    apiMocks.listMembers
      .mockRejectedValueOnce(new Error('members unavailable'))
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          workspace_id: 'ws-1',
          user_id: 'user-1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@test.com',
          avatar_url: null,
        },
      ])

    renderWithQuery(<TeamOverview />)

    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('No Teams')).toBeInTheDocument()
    expect(apiMocks.listMembers).toHaveBeenCalledTimes(2)
  })

  it('shows an error with retry when the members query fails on Teams › Issues', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [makeTeam()],
      total: 1,
    })
    apiMocks.listMembers
      .mockRejectedValueOnce(new Error('members unavailable'))
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          workspace_id: 'ws-1',
          user_id: 'user-1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@test.com',
          avatar_url: null,
        },
      ])

    renderWithQuery(<TeamWorkPage />)

    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Todo')).toBeInTheDocument()
    expect(apiMocks.listMembers).toHaveBeenCalledTimes(2)
  })

  it('shows members the combined Team view without admin controls', async () => {
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
        github_user_id: null,
        github_login: null,
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<TeamOverview />)

    // Member view: team selector + a single Issues view whose toolbar carries
    // the list/board toggle (no Issues/Tasks pill tabs).
    expect(await screen.findByText('Member:')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Engineering' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Engineering/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Switch to board view' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Create a Team')).not.toBeInTheDocument()
    expect(screen.queryByText('Manage Teams')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Teams')).not.toBeInTheDocument()
    expect(await screen.findByText('No Issues')).toBeInTheDocument()
  })

  it('toggles the member view between list and board', async () => {
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
        github_user_id: null,
        github_login: null,
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listIssues.mockResolvedValue({
      issues: [{ id: 'issue-1', team_id: 'team-1', status: 'todo' }],
      total: 1,
    })

    renderWithQuery(<TeamOverview />)

    expect(await screen.findByTestId('team-list')).toHaveTextContent('issue-1')
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to board view' }),
    )
    expect(await screen.findByTestId('team-board')).toHaveTextContent('issue-1')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to list view' }))
    expect(await screen.findByTestId('team-list')).toHaveTextContent('issue-1')
  })

  it('switches the member view Team from the selector', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [
        makeTeam({ id: 'team-1', name: 'Engineering', can_manage: false }),
        makeTeam({ id: 'team-2', name: 'Finance', can_manage: false }),
      ],
      total: 2,
    })
    apiMocks.listMembers.mockResolvedValue([
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        role: 'member',
        github_user_id: null,
        github_login: null,
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<TeamOverview />)

    fireEvent.click(await screen.findByRole('button', { name: /Engineering/ }))
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: 'Finance' }),
    )
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/teams',
        search: { team: 'team-2' },
        replace: true,
      })
    })
  })

  it('locks member-created issues to the Team and to self', async () => {
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
        github_user_id: null,
        github_login: null,
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<TeamOverview />)

    fireEvent.click(await screen.findByRole('button', { name: /New Issue/ }))
    const modal = await screen.findByTestId('create-issue-modal')
    expect(modal.textContent).toContain('"team_id":"team-1"')
    expect(modal.textContent).toContain('"lock_assignee_user_id":"user-1"')
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
        github_user_id: null,
        github_login: null,
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

  it('locks the add-member dialog while the request runs', async () => {
    let finish: () => void = () => {}
    apiMocks.addTeamMember.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve(makeMember()))),
    )
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
    const onClose = vi.fn()
    renderWithQuery(
      <AddTeamMemberDialog
        teamId="team-1"
        existing={[makeMember()]}
        onClose={onClose}
      />,
    )

    fireEvent.click(await screen.findByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

    const adding = await screen.findByRole('button', { name: 'Adding…' })
    expect(adding).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(adding)
    expect(apiMocks.addTeamMember).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
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
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('transfers ownership to another human member', async () => {
    apiMocks.transferTeamOwner.mockResolvedValue(
      makeTeam({ owner_user_id: 'user-2' }),
    )

    renderWithQuery(
      <TransferOwnerPopover
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
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Setup Owner' }))
    expect(
      await screen.findByPlaceholderText('Search for team member'),
    ).toBeInTheDocument()
    const makeOwner = screen.getByRole('button', { name: 'Make Team Owner' })
    expect(makeOwner).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Casey' }))
    fireEvent.click(makeOwner)

    await waitFor(() => {
      expect(apiMocks.transferTeamOwner).toHaveBeenCalledWith('team-1', {
        owner_user_id: 'user-2',
      })
    })
  })

  it('renders the design Team grid with the two-item card menu', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [
        makeTeam({ id: 'team-1', name: 'Engineering', member_count: 2 }),
        makeTeam({ id: 'team-2', name: 'Finance', member_count: 3 }),
      ],
      total: 2,
      unique_member_count: 4,
    })

    renderWithQuery(<TeamOverview />)

    expect(await screen.findByText('3 members')).toBeInTheDocument()
    expect(screen.queryByText('Total Members')).toBeNull()
    expect(screen.queryByText('All teams')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Engineering actions' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Add team member' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Edit Team' })).toBeNull()
  })

  it('renders the Teams dropdown child and toggles it', () => {
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
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Issues'))
    expect(onSelect).toHaveBeenCalledWith('teams-issues')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Teams' }))
    expect(onToggleExpand).toHaveBeenCalledWith('teams')
  })

  it('shows all teams by default and filters by Team pill', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [
        makeTeam({ id: 'team-1', name: 'Engineering' }),
        makeTeam({ id: 'team-2', name: 'Finance', member_count: 1 }),
      ],
      total: 2,
    })
    // Mock the has_team=true server response: non-team issues never arrive.
    apiMocks.listIssues.mockResolvedValue({
      issues: [
        { id: 'issue-1', team_id: 'team-1', status: 'todo' },
        { id: 'issue-2', team_id: 'team-2', status: 'in_progress' },
      ],
      total: 2,
    })

    teamIssueViewStore.setState({ viewMode: 'board' })
    renderWithQuery(<TeamWorkPage />)

    expect(await screen.findByText('Todo')).toBeInTheDocument()
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()
    expect(apiMocks.listIssues).toHaveBeenCalledWith(
      expect.objectContaining({ has_team: true }),
    )

    // All view: every team-scoped issue from the filtered API response.
    const board = await screen.findByTestId('team-board')
    expect(board).toHaveTextContent('issue-1')
    expect(board).toHaveTextContent('issue-2')

    // Filtering to one Team narrows the board.
    fireEvent.click(screen.getByText('Finance'))
    await waitFor(() => {
      expect(screen.getByTestId('team-board')).toHaveTextContent('issue-2')
    })
    expect(screen.getByTestId('team-board')).not.toHaveTextContent('issue-1')

    // Clicking the active pill toggles back to All.
    fireEvent.click(screen.getByText('Finance'))
    await waitFor(() => {
      expect(screen.getByTestId('team-board')).toHaveTextContent('issue-1')
    })
  })

  it('renders the design Team list on Teams › Issues', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [makeTeam({ id: 'team-1', name: 'Engineering' })],
      total: 1,
    })
    apiMocks.listIssues.mockResolvedValue({
      issues: [{ id: 'issue-1', team_id: 'team-1', status: 'todo' }],
      total: 1,
    })

    renderWithQuery(<TeamWorkPage />)

    expect(await screen.findByTestId('team-list')).toHaveAttribute(
      'data-variant',
      'team',
    )
    expect(screen.getByTestId('team-list')).toHaveTextContent('issue-1')
  })

  it('scopes the create modal to the Team picker in the All view', async () => {
    apiMocks.listTeams.mockResolvedValue({
      teams: [
        makeTeam({ id: 'team-1', name: 'Engineering' }),
        makeTeam({ id: 'team-2', name: 'Finance', member_count: 1 }),
      ],
      total: 2,
    })
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<TeamWorkPage />)

    fireEvent.click(await screen.findByRole('button', { name: /New Issue/ }))
    expect(
      (await screen.findByTestId('create-issue-modal')).textContent,
    ).toContain('"show_team_picker":true')

    fireEvent.click(screen.getByText('Finance'))
    fireEvent.click(screen.getByRole('button', { name: /New Issue/ }))
    await waitFor(() => {
      expect(screen.getByTestId('create-issue-modal').textContent).toContain(
        '"team_id":"team-2"',
      )
    })
  })

  it('redirects non-admins away from the admin work pages', async () => {
    apiMocks.listMembers.mockResolvedValue([
      {
        id: 'm-2',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        role: 'member',
        github_user_id: null,
        github_login: null,
        name: 'Owner',
        email: 'owner@test.com',
        avatar_url: null,
      },
    ])
    apiMocks.listTeams.mockResolvedValue({ teams: [], total: 0 })
    apiMocks.listIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<TeamWorkPage />)

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
      screen.getByRole('button', { name: 'Setup Owner' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Team actions' }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search for anything...')).toBeVisible()
    expect(screen.getByText('Team Owner')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Agent settings' }),
    ).toHaveLength(2)

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
    expect(screen.getByRole('button', { name: 'Export Data' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Remove Owner' }),
    ).not.toBeInTheDocument()

    expect(screen.getByText('Total members')).toBeInTheDocument()
    expect(screen.getByText('Total Assigned Tasks')).toBeInTheDocument()
    expect(screen.getByText('Total Activity')).toBeInTheDocument()
    expect(screen.getAllByText('02')).toHaveLength(2)
    expect(screen.getByText('07')).toBeInTheDocument()
  })

  it('exports the visible member rows as CSV', () => {
    const csv = membersToCsv([makeMember(), caseyMember], 'user-1')
    expect(csv.split('\n')).toEqual([
      'User,Email,Role,Assigned Tasks',
      '"Owner","owner@test.com","Team Owner","2"',
      '"Casey","casey@test.com","Member","0"',
    ])
  })

  it('opens Team settings from a member row', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember()],
      total: 1,
    })
    apiMocks.getTeamAgentPolicy.mockResolvedValue({
      team_id: 'team-1',
      policy: {
        allowed_areas: ['tasks'],
        blocked_risk_classes: [],
        blocked_connector_ids: [],
        approval_required: [],
      },
      can_edit: true,
      updated_at: null,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Agent settings' }),
    )
    expect(
      await screen.findByRole('dialog', { name: 'Team settings' }),
    ).toBeInTheDocument()
  })

  it('opens Agent policy from the Team actions menu', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember()],
      total: 1,
    })
    apiMocks.getTeamAgentPolicy.mockResolvedValue({
      team_id: 'team-1',
      policy: {
        allowed_areas: ['tasks'],
        blocked_risk_classes: [],
        blocked_connector_ids: [],
        approval_required: [],
      },
      can_edit: true,
      updated_at: null,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Team actions' }))
    for (const item of ['View details', 'Copy link', 'Delete team']) {
      expect(
        await screen.findByRole('menuitem', { name: item }),
      ).toBeInTheDocument()
    }
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Team settings' }),
    )

    expect(
      await screen.findByRole('dialog', { name: 'Team settings' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('checkbox', { name: 'Tasks' }),
    ).toBeInTheDocument()
    expect(apiMocks.getTeamAgentPolicy).toHaveBeenCalledWith('team-1')
  })

  it('hides Setup Owner when transfer is not allowed', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam({ can_transfer_owner: false }))
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember()],
      total: 1,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    expect(
      await screen.findByRole('button', { name: 'Add a team member' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Setup Owner' }),
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

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Casey' }))
    // Nothing is removed until the confirmation.
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Remove Casey from')
    expect(apiMocks.removeTeamMember).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(apiMocks.removeTeamMember).toHaveBeenCalledWith('team-1', 'tm-2')
    })
    expect(toast.success).toHaveBeenCalledWith('Casey removed from the team')
  })

  it('keeps the member when removal is cancelled', async () => {
    apiMocks.getTeam.mockResolvedValue(makeTeam())
    apiMocks.listTeamMembers.mockResolvedValue({
      members: [makeMember(), caseyMember],
      total: 2,
    })

    renderWithQuery(
      <TeamDetail teamId="team-1" tab="members" onTabChange={() => {}} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Casey' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMocks.removeTeamMember).not.toHaveBeenCalled()
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
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Remove',
      }),
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
