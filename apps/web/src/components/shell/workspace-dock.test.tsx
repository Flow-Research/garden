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

vi.mock('@garden/core/chat', () => ({
  useChatStore: Object.assign(
    (selector?: (state: { activeSessionId: string | null; setActiveSession: (id: string | null) => void }) => unknown) => {
      const state = {
        activeSessionId: null,
        setActiveSession: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        activeSessionId: null,
        setActiveSession: vi.fn(),
      }),
    },
  ),
}))

vi.mock('dockview', () => ({
  DockviewDefaultTab: () => null,
  DockviewReact: () => null,
  themeDark: {},
  themeLight: {},
}))

vi.mock('@garden/ui/components/common/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

vi.mock('@garden/ui/components/ui/button', () => ({
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

type FakeSerializedPanel = {
  id: string
  contentComponent: FakePanelKind
  title?: string
  params?: {
    kind: FakePanelKind
    title: string
    entityId?: string
    canonicalId: string
  }
}

type FakeSerializedGroup = {
  id: string
  views: string[]
  activeView?: string | null
}

type FakeSerializedDock = {
  grid: {
    root: {
      type: 'branch'
      data: Array<{
        type: 'leaf'
        data: FakeSerializedGroup
      }>
    }
    height: number
    width: number
    orientation: 'horizontal' | 'vertical'
  }
  panels: Record<string, FakeSerializedPanel>
  activeGroup?: string | null
}

function makeSerializedDock(
  groups: Array<{
    id: string
    activePanelId?: string | null
    panels: Array<{
      id: string
      kind: FakePanelKind
      title: string
      entityId?: string
    }>
  }>,
  activeGroup?: string | null,
): FakeSerializedDock {
  const panels = Object.fromEntries(
    groups.flatMap((group) =>
      group.panels.map((panel) => [
        panel.id,
        {
          id: panel.id,
          contentComponent: panel.kind,
          title: panel.title,
          params: {
            kind: panel.kind,
            title: panel.title,
            entityId: panel.entityId,
            canonicalId: panel.entityId
              ? `${panel.kind}:${panel.entityId}`
              : `${panel.kind}:singleton`,
          },
        } satisfies FakeSerializedPanel,
      ]),
    ),
  )

  return {
    grid: {
      root: {
        type: 'branch',
        data: groups.map((group) => ({
          type: 'leaf',
          data: {
            id: group.id,
            views: group.panels.map((panel) => panel.id),
            activeView: group.activePanelId ?? null,
          },
        })),
      },
      height: 0,
      width: 0,
      orientation: 'horizontal',
    },
    panels,
    activeGroup: activeGroup ?? null,
  }
}

type FakePanel = {
  id: string
  group: FakeGroup
  params: {
    kind: FakePanelKind
    title: string
    entityId?: string
    canonicalId: string
  }
  initialApiParametersVisible: boolean
  api: {
    id: string
    title: string
    getParameters: () => {
      kind?: FakePanelKind
      title?: string
      entityId?: string
      canonicalId?: string
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
  private overlayListeners: Array<
    (event: { position: string; preventDefault: () => void }) => void
  > = []
  private groupCounter = 0

  toJSON = vi.fn(() => ({
    grid: {
      root: {
        type: 'branch',
        data: this.groups.map((group) => ({
          type: 'leaf',
          data: {
            id: group.id,
            views: group.panels.map((panel) => panel.id),
            activeView: group.activePanel?.id ?? null,
          },
        })),
      },
      height: 0,
      width: 0,
      orientation: 'horizontal',
    },
    panels: Object.fromEntries(
      this.groups.flatMap((group) =>
        group.panels.map((panel) => {
          const params = panel.params
          return [
            panel.id,
            {
              id: panel.id,
              contentComponent: params.kind,
              title: panel.api.title,
              params,
            } satisfies FakeSerializedPanel,
          ]
        }),
      ),
    ),
    activeGroup: this.activeGroup?.id ?? null,
  } satisfies FakeSerializedDock))

  hasMaximizedGroup() {
    return false
  }

  exitMaximizedGroup() {}

  moveToNext() {}

  moveToPrevious() {}

  get panels() {
    return this.groups.flatMap((group) => group.panels)
  }

  getPanel(id: string) {
    return this.panels.find((panel) => panel.id === id)
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

  onWillShowOverlay(
    listener: (event: { position: string; preventDefault: () => void }) => void,
  ) {
    this.overlayListeners.push(listener)
    return {
      dispose: () => removeListener(this.overlayListeners, listener),
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

    for (const node of data.grid.root.data) {
      const serializedGroup = node.data
      const group = this.createGroup(serializedGroup.id)
      for (const panelId of serializedGroup.views) {
        const serializedPanel = data.panels[panelId]
        if (!serializedPanel?.params) {
          continue
        }

        const panel = this.createPanel(group, {
          id: serializedPanel.id,
          kind: serializedPanel.params.kind,
          title: serializedPanel.title ?? serializedPanel.params.title,
          entityId: serializedPanel.params.entityId,
          canonicalId: serializedPanel.params.canonicalId,
        })
        group.panels.push(panel)
        if (serializedGroup.activeView === panel.id) {
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

  setVisibleGroupPanel(
    groupId: string,
    panelId: string,
    options?: { keepContainerActivePanel?: boolean },
  ) {
    const group = this.getGroup(groupId)
    const panel = group?.panels.find((candidate) => candidate.id === panelId)
    if (!group || !panel) return

    const previousGroupId = this.activeGroup?.id ?? null
    this.activeGroup = group
    group.activePanel = panel

    if (!options?.keepContainerActivePanel) {
      this.activePanel = panel
    }

    if (previousGroupId !== group.id) {
      this.activeGroupListeners.forEach((listener) => listener())
    }

    if (!options?.keepContainerActivePanel) {
      this.activePanelListeners.forEach((listener) => listener())
    }
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
      params: {
        kind: params.kind,
        title: params.title,
        entityId: params.entityId,
        canonicalId: params.canonicalId,
      },
      initialApiParametersVisible: false,
      api: {
        id: params.id,
        title: params.title,
        getParameters: () =>
          panel.initialApiParametersVisible
            ? { ...panel.params }
            : {},
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

    expect(mockSetQueryState).toHaveBeenLastCalledWith({
      panel: 'chat',
      panelTitle: 'New Chat',
      panelEntityId: null,
    })
  })

  it('restores a saved layout with no active group by selecting the first non-blank panel', async () => {
    const api = new FakeDockApi()

    window.localStorage.setItem(
      'garden:dockview:workspace-1',
      JSON.stringify(
        makeSerializedDock(
          [
            {
              id: 'group-1',
              activePanelId: null,
              panels: [{ id: 'panel-1', kind: 'chat', title: 'New Chat' }],
            },
          ],
          null,
        ),
      ),
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
      'garden:dockview:workspace-1',
      JSON.stringify(
        makeSerializedDock(
          [
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
          'group-1',
        ),
      ),
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

  it('follows the active group panel when dockview keeps a stale container activePanel', async () => {
    const api = new FakeDockApi()

    window.localStorage.setItem(
      'garden:dockview:workspace-1',
      JSON.stringify(
        makeSerializedDock(
          [
            {
              id: 'group-1',
              activePanelId: 'panel-1',
              panels: [{ id: 'panel-1', kind: 'inbox', title: 'Inbox' }],
            },
            {
              id: 'group-2',
              activePanelId: 'panel-2',
              panels: [{ id: 'panel-2', kind: 'chat', title: 'New Chat' }],
            },
          ],
          'group-1',
        ),
      ),
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
        'inbox',
      )
    })

    await act(async () => {
      api.setVisibleGroupPanel('group-2', 'panel-2', {
        keepContainerActivePanel: true,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('dock-state')).toHaveAttribute(
        'data-group',
        'group-2',
      )
    })

    expect(screen.getByTestId('dock-state')).toHaveAttribute(
      'data-panel',
      'chat',
    )
  })

  it('drops invalid saved layouts and falls back to inbox', async () => {
    const api = new FakeDockApi()

    window.localStorage.setItem(
      'garden:dockview:workspace-1',
      JSON.stringify({
        grid: {
          root: {
            type: 'branch',
            data: [
              {
                type: 'leaf',
                data: {
                  id: 'group-1',
                  views: ['panel-1'],
                  activeView: 'panel-1',
                },
              },
            ],
          },
          height: 0,
          width: 0,
          orientation: 'horizontal',
        },
        panels: {
          'panel-1': {
            id: 'panel-1',
            contentComponent: 'agent-detail',
            title: 'Agent',
            params: {
              kind: 'agent-detail',
              title: 'Agent',
              canonicalId: 'agent-detail:singleton',
            },
          },
        },
        activeGroup: 'group-1',
      }),
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
        'inbox',
      )
    })

    expect(window.localStorage.getItem('garden:dockview:workspace-1')).toBe(
      null,
    )
  })
})
