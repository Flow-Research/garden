import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import AgentsPage from '@/features/agents/components/agents-page'
import { AutomationsPage } from '@/features/automations/automations-page'
import { MembersTab } from '@/features/settings/components/members-tab'
import { AgentDetail } from '@/features/agents/components/agent-detail'
import { AutomationDetailPage } from '@/features/automations/automation-detail-page'
import { ApiError } from '@/lib/api/errors'

const serverError = () =>
  new ApiError({ message: 'Server error', status: 500, statusText: '' })
const notFound = () =>
  new ApiError({ message: 'Not found', status: 404, statusText: '' })

/**
 * A failed list load must say so and offer a retry, not fall through to the
 * empty state ("No agents yet") as if the workspace had nothing in it.
 */

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listAutomations: vi.fn(),
  listMembers: vi.fn(),
  listWorkspaceInvitations: vi.fn(),
  getAutomation: vi.fn(),
  listAutomationRuns: vi.fn(async () => []),
  getAgent: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

function renderScreen(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">{ui}</WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

async function expectLoadErrorThenRetry(message: string) {
  expect(await screen.findByText(message)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await vi.waitFor(() => expect(screen.queryByText(message)).toBeNull())
}

describe('list screens on a failed load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } as User,
    })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
  })

  it('agents', async () => {
    api.listAgents
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])
    renderScreen(<AgentsPage onOpenAgent={vi.fn()} />)

    await expectLoadErrorThenRetry('Could not load agents.')
    expect(screen.getByText('No agents yet')).toBeInTheDocument()
  })

  it('automations', async () => {
    api.listAutomations
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ automations: [] })
    renderScreen(<AutomationsPage />)

    expect(screen.queryByText('No automations yet')).toBeNull()
    await expectLoadErrorThenRetry('Could not load automations.')
    expect(screen.getByText('No automations yet')).toBeInTheDocument()
  })

  it('members', async () => {
    api.listWorkspaceInvitations.mockResolvedValue([])
    api.listMembers
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])
    renderScreen(<MembersTab />)

    expect(screen.getByLabelText('Loading members')).toBeInTheDocument()
    expect(screen.queryByText('No members found.')).toBeNull()
    await expectLoadErrorThenRetry('Could not load members.')
    expect(screen.getByText('No members found.')).toBeInTheDocument()
  })
})

describe('detail pages on a failed load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'user-1' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
    api.listMembers.mockResolvedValue([])
    api.listAgents.mockResolvedValue([])
  })

  it('automation: retry on a server error, "not found" only for a 404', async () => {
    api.getAutomation.mockRejectedValueOnce(serverError())
    const view = renderScreen(<AutomationDetailPage automationId="auto-1" />)
    expect(
      await screen.findByText('Could not load this automation.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Automation not found')).toBeNull()
    view.unmount()

    api.getAutomation.mockRejectedValueOnce(notFound())
    renderScreen(<AutomationDetailPage automationId="auto-1" />)
    expect(await screen.findByText('Automation not found')).toBeInTheDocument()
  })

  it('agent: retry on a server error, "not found" only for a 404', async () => {
    api.getAgent.mockRejectedValueOnce(serverError())
    const view = renderScreen(
      <AgentDetail agentId="agent-1" onOpenSkill={vi.fn()} />,
    )
    expect(
      await screen.findByText('Could not load this agent.'),
    ).toBeInTheDocument()
    view.unmount()

    api.getAgent.mockRejectedValueOnce(notFound())
    renderScreen(<AgentDetail agentId="agent-1" onOpenSkill={vi.fn()} />)
    expect(await screen.findByText('Agent not found.')).toBeInTheDocument()
  })
})
