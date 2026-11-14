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
    issueStatus: [
      { name: 'cancelled', value: 6, color: 'pink' },
      { name: 'done', value: 1, color: 'green' },
      { name: 'blocked', value: 2, color: 'orange' },
      { name: 'todo', value: 1, color: 'blue' },
    ],
    issuePriority: [
      { name: 'medium', value: 9, color: 'yellow' },
      { name: 'urgent', value: 1, color: 'red' },
    ],
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
    agents: [
      {
        id: 'garden',
        name: 'Garden',
        status: 'active',
        roleTitle: 'Workspace assistant',
        activeIssueCount: 2,
      },
    ],
    connections: [
      { id: 'github', label: 'GitHub', status: 'connected', toolCount: 45 },
    ],
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS}>
        <DashboardPage />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
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

    fireEvent.click(
      await screen.findByRole('button', { name: /Blocked.*Needs a human/ }),
    )

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

  it('shows completion against non-cancelled work and priority shares of all tasks', async () => {
    renderDashboard({ agentCount: 1 })
    expect(
      await screen.findByRole('heading', { name: 'Overview' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('meter', { name: 'Completed work' })
        .getAttribute('aria-valuenow'),
    ).toBe('25')
    expect(screen.getByText('cancelled').textContent).toContain(
      'excluded from total',
    )
    expect(screen.getByText('10 across all tasks')).toBeTruthy()
    expect(screen.getByText('10%')).toBeTruthy()
    expect(screen.getByText('90%')).toBeTruthy()
    const statusPanel = screen
      .getByRole('heading', { name: 'Issues by Status' })
      .closest('section')
    const segments = statusPanel?.querySelectorAll('[aria-hidden="true"] > div')
    expect(
      Array.from(segments ?? []).map((segment) =>
        segment.getAttribute('style'),
      ),
    ).toEqual([
      expect.stringContaining('width: 25%'),
      expect.stringContaining('width: 50%'),
      expect.stringContaining('width: 25%'),
    ])
  })

  it('keeps tasks and activity before agents and connections, with working resource links', async () => {
    renderDashboard({ agentCount: 1 })
    await screen.findByRole('heading', { name: 'Connections' })
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Issues by Status',
      'Issues by Priority',
      'Recent Tasks',
      'Recent Activity',
      'Agents',
      'Connections',
    ])
    fireEvent.click(
      screen.getByRole('button', { name: /Agents.*skills available/ }),
    )
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/agents' })
    fireEvent.click(screen.getByRole('button', { name: /GitHub/ }))
    expect(nav.openConnections).toHaveBeenCalled()
  })
})
