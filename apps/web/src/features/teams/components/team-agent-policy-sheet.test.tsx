import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import {
  DEFAULT_TEAM_AGENT_POLICY,
  type TeamAgentPolicyResponse,
} from '@garden/core/teams/agent-policy'
import { toast } from 'sonner'
import { teamKeys } from '../queries'
import { TeamAgentPolicySheet } from './team-agent-policy-sheet'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const apiMocks = vi.hoisted(() => ({
  getTeamAgentPolicy: vi.fn(),
  updateTeamAgentPolicy: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMocks,
  getApi: () => apiMocks,
  listConnections: () => Promise.resolve({ integrations: [] }),
}))

function response(
  overrides: Partial<TeamAgentPolicyResponse> = {},
): TeamAgentPolicyResponse {
  return {
    team_id: 'team-1',
    policy: DEFAULT_TEAM_AGENT_POLICY,
    can_edit: true,
    updated_at: null,
    ...overrides,
  }
}

function renderSheet(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <TeamAgentPolicySheet
          onOpenChange={onOpenChange}
          open
          teamId="team-1"
          teamName="Technical"
        />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return { queryClient, onOpenChange }
}

describe('TeamAgentPolicySheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves an admin edit optimistically and closes', async () => {
    apiMocks.getTeamAgentPolicy.mockResolvedValue(response())
    let resolveSave: (value: TeamAgentPolicyResponse) => void = () => {}
    apiMocks.updateTeamAgentPolicy.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )
    const { queryClient, onOpenChange } = renderSheet()

    const knowledge = await screen.findByRole('checkbox', {
      name: 'Knowledge',
    })
    const save = screen.getByRole('button', { name: 'Save Changes' })
    expect(save).toBeDisabled()

    fireEvent.click(knowledge)
    expect(save).toBeEnabled()
    fireEvent.click(save)

    const expected = {
      ...DEFAULT_TEAM_AGENT_POLICY,
      allowed_areas: DEFAULT_TEAM_AGENT_POLICY.allowed_areas.filter(
        (area) => area !== 'knowledge',
      ),
    }
    await waitFor(() =>
      expect(apiMocks.updateTeamAgentPolicy).toHaveBeenCalledWith(
        'team-1',
        expected,
      ),
    )
    await waitFor(() =>
      expect(
        queryClient.getQueryData<TeamAgentPolicyResponse>(
          teamKeys.agentPolicy('ws-1', 'team-1'),
        )?.policy,
      ).toEqual(expected),
    )

    resolveSave(response({ policy: expected }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toast.success).toHaveBeenCalled()
  })

  it('rolls the cache back when the save fails', async () => {
    apiMocks.getTeamAgentPolicy.mockResolvedValue(response())
    apiMocks.updateTeamAgentPolicy.mockRejectedValue(new Error('nope'))
    const { queryClient } = renderSheet()

    fireEvent.click(
      await screen.findByRole('tab', { name: 'Connector Grants' }),
    )
    fireEvent.click(await screen.findByRole('switch', { name: 'GitHub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(
      queryClient.getQueryData<TeamAgentPolicyResponse>(
        teamKeys.agentPolicy('ws-1', 'team-1'),
      )?.policy,
    ).toEqual(DEFAULT_TEAM_AGENT_POLICY)
  })

  it('shows the Team owner a read-only policy', async () => {
    apiMocks.getTeamAgentPolicy.mockResolvedValue(response({ can_edit: false }))
    renderSheet()

    expect(
      await screen.findByText(
        'Only workspace owners and admins can change this policy.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Tasks' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  it('renders unbacked design controls disabled with a Coming soon badge', async () => {
    apiMocks.getTeamAgentPolicy.mockResolvedValue(response())
    renderSheet()

    for (const label of [
      'Chats',
      'Home',
      'Delete projects',
      'Manage billing',
      'Read locked files',
    ]) {
      expect(
        await screen.findByRole('checkbox', { name: label }),
      ).toHaveAttribute('aria-disabled', 'true')
    }
    expect(screen.getByRole('tab', { name: /Admin Policy/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('combobox', { name: 'Team Role' })).toHaveAttribute(
      'data-disabled',
    )
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(7)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chats' }))
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  it('blocks a risk class from a Restricted card', async () => {
    apiMocks.getTeamAgentPolicy.mockResolvedValue(response())
    apiMocks.updateTeamAgentPolicy.mockResolvedValue(response())
    renderSheet()

    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Destructive actions' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(apiMocks.updateTeamAgentPolicy).toHaveBeenCalledWith('team-1', {
        ...DEFAULT_TEAM_AGENT_POLICY,
        blocked_risk_classes: ['destructive'],
      }),
    )
  })

  it('shows approval rules as selects with the Team owner as approver', async () => {
    apiMocks.getTeamAgentPolicy.mockResolvedValue(
      response({
        policy: { ...DEFAULT_TEAM_AGENT_POLICY, approval_required: ['write'] },
      }),
    )
    renderSheet()

    fireEvent.click(
      await screen.findByRole('tab', { name: 'Task Approval Rules' }),
    )
    expect(
      await screen.findByRole('combobox', { name: 'Write changes' }),
    ).toHaveTextContent('Approval required')
    expect(
      screen.getByRole('combobox', { name: 'Destructive actions' }),
    ).toHaveTextContent('Follow agent settings')
    const approver = screen.getByRole('combobox', { name: 'Default Approver' })
    expect(approver).toHaveTextContent('Team owner')
    expect(approver).toHaveAttribute('data-disabled')
  })
})
