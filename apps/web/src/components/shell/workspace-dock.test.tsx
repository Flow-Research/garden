import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes } from 'react'

vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: (
    selector?: (state: { workspace: { name: string } }) => unknown,
  ) => {
    const state = { workspace: { name: 'Workspace One' } }
    return selector ? selector(state) : state
  },
}))

vi.mock('@garden/ui/components/ui/sidebar', () => ({
  useSidebar: () => ({
    state: 'collapsed',
    toggleSidebar: vi.fn(),
  }),
}))

vi.mock('@garden/ui/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/features/inbox', () => ({
  InboxPage: () => <div>Inbox page</div>,
}))

vi.mock('@/features/skills/components', () => ({
  SkillsPage: ({ focusedSkillId }: { focusedSkillId?: string }) => (
    <div>Skills page {focusedSkillId}</div>
  ),
}))

vi.mock('@/features/dashboard', () => ({
  DashboardPage: () => <div>Dashboard page</div>,
}))

vi.mock('@/features/connections', () => ({
  ConnectionsPage: ({
    focusedConnectorId,
  }: {
    focusedConnectorId?: string
  }) => <div>Connections page {focusedConnectorId}</div>,
}))

vi.mock('@/features/agents/components', () => ({
  AgentsPage: () => <div>Agents page</div>,
  AgentDetail: ({ agentId }: { agentId: string }) => <div>Agent {agentId}</div>,
}))

vi.mock('@/features/issues/components', () => ({
  IssuesPage: () => <div>Issues page</div>,
  IssueDetail: ({ issueId }: { issueId: string }) => <div>Issue {issueId}</div>,
}))

vi.mock('@/features/chat/components/agent-interaction-screen', () => ({
  AgentInteractionScreen: ({ sessionId }: { sessionId: string | null }) => (
    <div>Chat {sessionId}</div>
  ),
}))

vi.mock('@/features/automations', () => ({
  AutomationsPage: () => <div>Automations page</div>,
  AutomationDetailPage: ({ automationId }: { automationId: string }) => (
    <div>Automation {automationId}</div>
  ),
}))

import {
  WorkspaceDockProvider,
  WorkspaceDockView,
  useWorkspaceDock,
} from './workspace-dock'

let capturedDock: ReturnType<typeof useWorkspaceDock> | null = null
let rectSpy: { mockRestore: () => void } | null = null

function DockProbe() {
  capturedDock = useWorkspaceDock()
  const active = capturedDock?.activePanel
  return (
    <div data-testid="active-panel">
      {active
        ? `${active.kind}:${active.entityId ?? ''}:${active.title}`
        : 'none'}
    </div>
  )
}

function renderDock({ view = false }: { view?: boolean } = {}) {
  return render(
    <WorkspaceDockProvider workspaceId="workspace-1">
      <DockProbe />
      {view ? <WorkspaceDockView /> : null}
    </WorkspaceDockProvider>,
  )
}

function readPersistedLayout() {
  const raw = window.localStorage.getItem('garden:flexlayout:workspace-1')
  expect(raw).toBeTruthy()
  return raw ?? ''
}

function readPersistedTabs() {
  const layout = JSON.parse(readPersistedLayout()) as {
    layout: { children?: Array<{ children?: Array<{ config?: unknown }> }> }
  }
  return (
    layout.layout.children?.flatMap((tabset) => tabset.children ?? []) ?? []
  )
}

describe('WorkspaceDockProvider', () => {
  beforeEach(() => {
    capturedDock = null
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 800,
        width: 1200,
        height: 800,
        toJSON: () => ({}),
      })
    window.localStorage.clear()
  })

  afterEach(() => {
    rectSpy?.mockRestore()
    rectSpy = null
    cleanup()
  })

  it('starts from the default inbox tab without URL state', () => {
    renderDock()

    expect(screen.getByTestId('active-panel')).toHaveTextContent('inbox::Inbox')
    expect(
      window.localStorage.getItem('garden:flexlayout:workspace-1'),
    ).toBeNull()
  })

  it('opens and persists a FlexLayout tab from the dock API', async () => {
    renderDock()

    act(() => {
      capturedDock?.openPanel({
        kind: 'issue-detail',
        title: 'Fix dock',
        entityId: 'issue-1',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('active-panel')).toHaveTextContent(
        'issue-detail:issue-1:Fix dock',
      )
    })

    expect(readPersistedLayout()).toContain('issue-detail:issue-1')
  })

  it('restores the last active tab from the persisted FlexLayout model', async () => {
    const first = renderDock()

    act(() => {
      capturedDock?.openPanel({
        kind: 'agent-detail',
        title: 'Planner',
        entityId: 'agent-1',
      })
    })

    await waitFor(() => {
      expect(readPersistedLayout()).toContain('agent-detail:agent-1')
    })

    first.unmount()
    capturedDock = null
    renderDock()

    expect(screen.getByTestId('active-panel')).toHaveTextContent(
      'agent-detail:agent-1:Planner',
    )
  })

  it('reuses one tab per non-chat panel kind', async () => {
    renderDock()

    act(() => {
      capturedDock?.openPanel({
        kind: 'issue-detail',
        title: 'First issue',
        entityId: 'issue-1',
      })
      capturedDock?.openPanel({
        kind: 'issue-detail',
        title: 'Second issue',
        entityId: 'issue-2',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('active-panel')).toHaveTextContent(
        'issue-detail:issue-2:Second issue',
      )
    })
    const issueTabs = readPersistedTabs().filter((tab) => {
      const config = tab.config as { kind?: string } | undefined
      return config?.kind === 'issue-detail'
    })
    expect(issueTabs).toHaveLength(1)
    expect(readPersistedLayout()).toContain('issue-detail:issue-2')
  })

  it('replaces a targeted blank tab instead of opening a second non-chat tab', async () => {
    renderDock()
    let blankId: string | null = null

    act(() => {
      blankId = capturedDock?.openNewTab() ?? null
      capturedDock?.openPanel(
        { kind: 'issues', title: 'Tasks' },
        { targetPanelId: blankId ?? undefined },
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('active-panel')).toHaveTextContent(
        'issues::Tasks',
      )
    })
    const tabs = readPersistedTabs()
    expect(tabs).toHaveLength(2)
    expect(readPersistedLayout()).toContain('issues:singleton')
  })

  it('keeps chat tabs in the FlexLayout model only', async () => {
    renderDock()

    act(() => {
      capturedDock?.openPanel({
        kind: 'chat',
        title: 'Design chat',
        entityId: 'chat-1',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('active-panel')).toHaveTextContent(
        'chat:chat-1:Design chat',
      )
    })
    expect(readPersistedLayout()).toContain('chat:chat-1')
  })

  it('closes tabs by canonical id', async () => {
    renderDock()

    act(() => {
      capturedDock?.openPanel({
        kind: 'chat',
        title: 'Design chat',
        entityId: 'chat-1',
      })
      capturedDock?.openPanel({ kind: 'issues', title: 'Tasks' })
      capturedDock?.closePanel('chat:chat-1')
    })

    await waitFor(() => {
      expect(screen.getByTestId('active-panel')).toHaveTextContent(
        'issues::Tasks',
      )
    })
    expect(readPersistedLayout()).not.toContain('chat:chat-1')
  })

  it('renders FlexLayout panels through the factory', async () => {
    renderDock({ view: true })

    expect(await screen.findByText('Inbox page')).toBeInTheDocument()
  })
})
