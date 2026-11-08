import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useIssuesScopeStore } from '@garden/app-state/issues/stores/issues-scope-store'
import { useIssueViewStore } from '@garden/app-state/issues/stores/view-store'
import { dashboardKeys } from '../dashboard.queries'
import { DashboardPage } from './dashboard-page'

const nav = vi.hoisted(() => ({
  navigate: vi.fn(),
  openIssue: vi.fn(),
  openConnections: vi.fn(),
}))
vi.mock('@/features/navigation/use-surface-navigation', () => ({
  useSurfaceNavigation: () => nav,
}))
vi.mock('../dashboard.server', () => ({}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: () => vi.fn() }),
    validator: () => ({ handler: () => vi.fn() }),
    handler: () => vi.fn(),
  }),
}))
vi.mock('@/lib/server/context', () => ({ requireAppRequestContext: vi.fn() }))

const WS = 'ws-1'

function renderDashboard({ agentCount = 0 } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  queryClient.setQueryData(dashboardKeys.overview(WS), {
    summary: {
      totalIssues: 4,
      openIssues: 3,
      blockedIssues: 2,
      completedIssues: 1,
      agentCount,
      skillCount: 0,
      connectedCount: 0,
      connectionCount: 0,
    },
  })
  queryClient.setQueryData(dashboardKeys.distribution(WS), {
    summary: { totalIssues: 4, openIssues: 3 },
    issueStatus: [],
    issuePriority: [],
  })
  queryClient.setQueryData(dashboardKeys.activity(WS), {
    unreadCount: 1,
    recentIssues: [],
    inbox: [
      {
        id: 'inbox-1',
        title: 'Connect Gmail',
        issue_id: '',
        type: 'connector_needed',
        severity: 'action_required',
        created_at: '2026-10-20T10:00:00.000Z',
      },
    ],
  })
  queryClient.setQueryData(dashboardKeys.resources(WS), {
    agents: [],
    connections: [],
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS}>
        <DashboardPage />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('DashboardPage links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useIssueViewStore.getState().clearFilters()
  })

  it('"Set one up" opens Agents, not Connectors', async () => {
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Set one up' }))
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/agents' })
    expect(nav.openConnections).not.toHaveBeenCalled()
  })

  it('"Blocked" opens the list filtered to blocked issues', async () => {
    useIssuesScopeStore.getState().setScope('agents')
    useIssueViewStore.getState().togglePriorityFilter('high')
    renderDashboard({ agentCount: 1 })

    fireEvent.click(await screen.findByText('Blocked'))

    expect(nav.navigate).toHaveBeenCalledWith({ to: '/tasks' })
    expect(useIssueViewStore.getState().statusFilters).toEqual(['blocked'])
    expect(useIssueViewStore.getState().priorityFilters).toEqual([])
    expect(useIssuesScopeStore.getState().scope).toBe('all')
  })

  it('opens an inbox item with no issue in the inbox', async () => {
    renderDashboard({ agentCount: 1 })
    fireEvent.click(await screen.findByText('Connect Gmail'))
    expect(nav.openIssue).not.toHaveBeenCalled()
    expect(nav.navigate).toHaveBeenCalledWith({ href: '/inbox?item=inbox-1' })
  })
})
