import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type { Team, TeamMember } from '@garden/core/types'
import { toast } from 'sonner'
import { TeamOverview } from './team-overview'
import { TeamDetail } from './team-detail'
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
  useNavigate: () => mockNavigate,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

vi.mock('./team-issues-panel', () => ({
  TeamIssuesPanel: () => <div data-testid="team-issues-panel" />,
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
    expect(toast.success).toHaveBeenCalledWith(
      'Engineering team has been created',
    )
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
    expect(screen.queryByText('Add member')).not.toBeInTheDocument()
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
})
