import type { ButtonHTMLAttributes } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryState = vi.hoisted(() => ({
  panel: null as string | null,
  panelTitle: null as string | null,
  panelEntityId: null as string | null,
}))

const mockSetQueryState = vi.hoisted(() => vi.fn())

vi.mock('nuqs', () => ({
  parseAsString: {},
  useQueryStates: () => [mockQueryState, mockSetQueryState],
}))

vi.mock('dockview', () => ({
  DockviewDefaultTab: () => null,
  DockviewReact: () => null,
  themeDark: {},
  themeLight: {},
}))

vi.mock('@accelerate/ui/components/common/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

vi.mock('@accelerate/ui/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/features/inbox', () => ({
  InboxPage: () => <div>Inbox page</div>,
}))

vi.mock('@/features/settings', () => ({
  SettingsPage: () => <div>Settings page</div>,
}))

vi.mock('@/features/skills/components', () => ({
  SkillsPage: () => <div>Skills page</div>,
}))

vi.mock('@/features/issues/components', () => ({
  IssuesPage: () => <div>Issues page</div>,
  IssueDetail: ({ issueId }: { issueId: string }) => <div>{issueId}</div>,
}))

vi.mock('@/features/chat/components/agent-interaction-screen', () => ({
  AgentInteractionScreen: () => <div>Chat page</div>,
}))

type FakePanelKind =
  | 'blank'
  | 'inbox'
  | 'issues'
  | 'issue-detail'
  | 'chat'
  | 'skill-editor'
  | 'capabilities'
  | 'settings'

type FakeSerializedPanel = {
  id: string
  kind: FakePanelKind
  title: string
  entityId?: string
}

type FakeSerializedGroup = {
  id: string
  panels: FakeSerializedPanel[]
  activePanelId?: string | null
}

type FakeSerializedDock = {
  __groups: FakeSerializedGroup[]
  activeGroup?: string | null
}

type FakePanel = {
  id: string
  group: FakeGroup
  api: {
    id: string
    title: string
    getParameters: () => {
      kind: FakePanelKind
      title: string
      entityId?: string
      canonicalId: string
    }
    setActive: () => void
    close: () => void
  }
}

type FakeGroup = {
  id: string
  panels: FakePanel[]
  activePanel: FakePanel | null
  api: {
    id: string
    maximize: () => void
  }
}

function removeListener<T>(listeners: T[], listener: T) {
  const index = listeners.indexOf(listener)
  if (index >= 0) {
    listeners.splice(index, 1)
  }
}

class FakeDockApi {
  groups: FakeGroup[] = []
  activeGroup: FakeGroup | null = null
  activePanel: FakePanel | null = null
  private activePanelListeners: Array<() => void> = []
  private activeGroupListeners: Array<() => void> = []
  private layoutListeners: Array<() => void> = []
  private groupCounter = 0

  toJSON = vi.fn(() => ({
    __groups: this.groups.map((group) => ({
      id: group.id,
      activePanelId: group.activePanel?.id ?? null,
      panels: group.panels.map((panel) => ({
        id: panel.id,
        kind: panel.api.getParameters().kind,
        title: panel.api.title,
        entityId: panel.api.getParameters().entityId,
      })),
    })),
    activeGroup: this.activeGroup?.id ?? null,
  }))

  hasMaximizedGroup() {
    return false
  }

  exitMaximizedGroup() {}

  moveToNext() {}

  moveToPrevious() {}

  get panels() {
    return this.groups.flatMap((group) => group.panels)
  }

  getGroup(id: string) {
    return this.groups.find((group) => group.id === id)
  }

  onDidActivePanelChange(listener: () => void) {
    this.activePanelListeners.push(listener)
    return {
      dispose: () => removeListener(this.activePanelListeners, listener),
    }
  }

  onDidActiveGroupChange(listener: () => void) {
    this.activeGroupListeners.push(listener)
    return {
      dispose: () => removeListener(this.activeGroupListeners, listener),
    }
  }

  onDidLayoutChange(listener: () => void) {
    this.layoutListeners.push(listener)
    return {
      dispose: () => removeListener(this.layoutListeners, listener),
    }
  }

  addPanel(options: {
    id: string
    title: string
    params: {
      kind: FakePanelKind
      title: string
      entityId?: string
      canonicalId: string
    }
    position?: {
      referenceGroup?: string
      referencePanel?: FakePanel
      direction?: string
    }
  }) {
    let group =
      (typeof options.position?.referenceGroup === 'string'
        ? this.getGroup(options.position.referenceGroup)
        : undefined) ??
      options.position?.referencePanel?.group ??
      this.activeGroup ??
      this.createGroup()

    if (!this.groups.includes(group)) {
      this.groups.push(group)
    }

    const panel = this.createPanel(group, {
      id: options.id,
      kind: options.params.kind,
      title: options.title,
      entityId: options.params.entityId,
      canonicalId: options.params.canonicalId,
    })

    group.panels.push(panel)
    this.emitLayout()
    return panel
  }

  fromJSON(data: FakeSerializedDock) {
    this.groups = []
    this.activeGroup = null
    this.activePanel = null

    for (const serializedGroup of data.__groups) {
      const group = this.createGroup(serializedGroup.id)
      for (const serializedPanel of serializedGroup.panels) {
        const panel = this.createPanel(group, {
          ...serializedPanel,
          canonicalId: serializedPanel.entityId
            ? `${serializedPanel.kind}:${serializedPanel.entityId}`
            : `${serializedPanel.kind}:singleton`,
        })
        group.panels.push(panel)
        if (serializedGroup.activePanelId === panel.id) {
          group.activePanel = panel
        }
      }
      this.groups.push(group)
    }

    if (data.activeGroup) {
      const nextGroup = this.getGroup(data.activeGroup) ?? null
      this.activeGroup = nextGroup
      this.activePanel = nextGroup?.activePanel ?? null
    }
  }

  setActivePanel(panel: FakePanel) {
    const previousGroupId = this.activeGroup?.id ?? null
    this.activeGroup = panel.group
    this.activePanel = panel
    panel.group.activePanel = panel

    if (previousGroupId !== panel.group.id) {
      this.activeGroupListeners.forEach((listener) => listener())
    }

    this.activePanelListeners.forEach((listener) => listener())
  }

  private createGroup(id?: string): FakeGroup {
    this.groupCounter += 1
    return {
      id: id ?? `group-${this.groupCounter}`,
      panels: [],
      activePanel: null,
      api: {
        id: id ?? `group-${this.groupCounter}`,
        maximize: () => {},
      },
    }
  }

  private createPanel(
    group: FakeGroup,
    params: {
      id: string
      kind: FakePanelKind
      title: string
      entityId?: string
      canonicalId: string
    },
  ): FakePanel {
    const panel = {
      id: params.id,
      group,
      api: {
        id: params.id,
        title: params.title,
        getParameters: () => ({
          kind: params.kind,
          title: params.title,
          entityId: params.entityId,
          canonicalId: params.canonicalId,
        }),
        setActive: () => this.setActivePanel(panel),
        close: () => {},
      },
    } satisfies FakePanel

    return panel
  }

  private emitLayout() {
    this.layoutListeners.forEach((listener) => listener())
  }
}

import {
  WorkspaceDockProvider,
  useWorkspaceDock,
} from './workspace-dock'

let capturedDock: ReturnType<typeof useWorkspaceDock> | null = null

function DockContextCapture() {
  capturedDock = useWorkspaceDock()

  return (
    <div
      data-group={capturedDock.activeGroupId ?? 'none'}
      data-panel={capturedDock.activePanel?.kind ?? 'none'}
      data-testid="dock-state"
    />
  )
}

describe('WorkspaceDockProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockSetQueryState.mockClear()
    mockQueryState.panel = null
    mockQueryState.panelTitle = null
    mockQueryState.panelEntityId = null
    capturedDock = null
  })

  it('opens inbox by default when there is no saved layout', async () => {
    const api = new FakeDockApi()

    render(
      <WorkspaceDockProvider workspaceId="workspace-1">
        <DockContextCapture />
      </WorkspaceDockProvider>,
    )

    await act(async () => {
      capturedDock?.handleReady({ api } as never)
    })

    await waitFor(() => {
      expect(screen.getByTestId('dock-state')).toHaveAttribute(
        'data-panel',
        'inbox',
      )
    })

    expect(mockSetQueryState).toHaveBeenCalledWith({
      panel: 'inbox',
      panelTitle: 'Inbox',
      panelEntityId: null,
    })
  })

  it('commits active panel immediately when opening chat', async () => {
    const api = new FakeDockApi()

    render(
      <WorkspaceDockProvider workspaceId="workspace-1">
        <DockContextCapture />
      </WorkspaceDockProvider>,
    )

    await act(async () => {
      capturedDock?.handleReady({ api } as never)
    })

    await act(async () => {
      capturedDock?.openPanel({ kind: 'chat', title: 'New Chat' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('dock-state')).toHaveAttribute(
        'data-panel',
        'chat',
      )
    })
  })

  it('restores a saved layout with no active group by selecting the first non-blank panel', async () => {
    const api = new FakeDockApi()

    window.localStorage.setItem(
      'accelerate:dockview:workspace-1',
      JSON.stringify({
        __groups: [
          {
            id: 'group-1',
            activePanelId: null,
            panels: [{ id: 'panel-1', kind: 'chat', title: 'New Chat' }],
          },
        ],
        activeGroup: null,
      } satisfies FakeSerializedDock),
    )

    render(
      <WorkspaceDockProvider workspaceId="workspace-1">
        <DockContextCapture />
      </WorkspaceDockProvider>,
    )

    await act(async () => {
      capturedDock?.handleReady({ api } as never)
    })

    await waitFor(() => {
      expect(screen.getByTestId('dock-state')).toHaveAttribute(
        'data-panel',
        'chat',
      )
    })
  })

  it('does not steal focus when backfilling an empty group with a blank panel', async () => {
    const api = new FakeDockApi()

    window.localStorage.setItem(
      'accelerate:dockview:workspace-1',
      JSON.stringify({
        __groups: [
          {
            id: 'group-1',
            activePanelId: 'panel-1',
            panels: [{ id: 'panel-1', kind: 'chat', title: 'New Chat' }],
          },
          {
            id: 'group-2',
            activePanelId: null,
            panels: [],
          },
        ],
        activeGroup: 'group-1',
      } satisfies FakeSerializedDock),
    )

    render(
      <WorkspaceDockProvider workspaceId="workspace-1">
        <DockContextCapture />
      </WorkspaceDockProvider>,
    )

    await act(async () => {
      capturedDock?.handleReady({ api } as never)
    })

    await waitFor(() => {
      expect(screen.getByTestId('dock-state')).toHaveAttribute(
        'data-group',
        'group-1',
      )
    })

    expect(screen.getByTestId('dock-state')).toHaveAttribute(
      'data-panel',
      'chat',
    )
    expect(api.getGroup('group-2')?.panels).toHaveLength(1)
  })
})
