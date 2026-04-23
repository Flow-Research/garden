'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { parseAsString, useQueryStates } from 'nuqs'
import {
  Columns2,
  File,
  Inbox,
  LayoutDashboard,
  LayoutList,
  Maximize2,
  MessageSquare,
  Pin,
  PinOff,
  Plug,
  Plus,
  BookOpenText,
  X,
} from 'lucide-react'
import {
  DockviewDefaultTab,
  DockviewReact,
  themeDark,
  themeLight,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewTheme,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from 'dockview'
import type { SerializedDockview } from 'dockview-core'
import { Result } from 'better-result'
import { useChatStore } from '@garden/core/chat'
import { useTheme } from '@garden/ui/components/common/theme-provider'
import { Button } from '@garden/ui/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@garden/ui/components/ui/context-menu'
import { InboxPage } from '@/features/inbox'
import { SkillsPage } from '@/features/skills/components'
import { IssueDetail, IssuesPage } from '@/features/issues/components'
import { AgentInteractionScreen } from '@/features/chat/components/agent-interaction-screen'
import { DashboardPage } from '@/features/dashboard'
import { ConnectionsPage } from '@/features/connections'

export type WorkspacePanelKind =
  | 'blank'
  | 'dashboard'
  | 'inbox'
  | 'issues'
  | 'issue-detail'
  | 'chat'
  | 'skill-editor'
  | 'capabilities'

export type WorkspacePanelInput = {
  kind: WorkspacePanelKind
  title: string
  entityId?: string
}

const workspacePanelKinds = [
  'blank',
  'dashboard',
  'inbox',
  'issues',
  'issue-detail',
  'chat',
  'skill-editor',
  'capabilities',
] as const

type WorkspacePanelParams = WorkspacePanelInput & {
  canonicalId: string
}

type DockPanelState = {
  id: string
  params?: unknown
  title?: string
  api: {
    id?: string
    title?: string
  }
}

type WorkspaceDockContextValue = {
  activeGroupId: string | null
  activePanel: WorkspacePanelInput | null
  activePanelIsPinned: boolean
  dockTheme: DockviewTheme
  handleReady: (event: DockviewReadyEvent) => void
  isReady: boolean
  openPanel: (
    panel: WorkspacePanelInput,
    options?: { position?: AddPanelPositionOptions; forceNew?: boolean },
  ) => string | null
  splitActivePanel: () => void
  splitPanel: (panelId: string) => void
  maximizeActivePanel: () => void
  openBlankInActiveGroup: () => string | null
  focusNextPanel: () => void
  focusPreviousPanel: () => void
  isPanelPinned: (panelId: string) => boolean
  toggleActivePanelPinned: () => void
  togglePanelPinned: (panelId: string) => void
}

const WorkspaceDockContext = createContext<WorkspaceDockContextValue | null>(
  null,
)

const singletonKinds = new Set<WorkspacePanelKind>([
  'dashboard',
  'inbox',
  'issues',
  'skill-editor',
  'capabilities',
])

const panelIcons: Record<
  WorkspacePanelKind,
  React.ComponentType<{ className?: string }>
> = {
  blank: File,
  dashboard: LayoutDashboard,
  inbox: Inbox,
  issues: LayoutList,
  'issue-detail': LayoutList,
  chat: MessageSquare,
  'skill-editor': BookOpenText,
  capabilities: Plug,
}

let dockPanelCounter = 0

function nextDockPanelId(kind: WorkspacePanelKind) {
  dockPanelCounter += 1
  return `${kind}:${Date.now()}:${dockPanelCounter}`
}

function isWorkspacePanelKind(value: unknown): value is WorkspacePanelKind {
  return (
    typeof value === 'string' &&
    workspacePanelKinds.includes(value as WorkspacePanelKind)
  )
}

function readPanelFromQueryState(input: {
  panel: string | null
  panelTitle: string | null
  panelEntityId: string | null
}): WorkspacePanelInput | null {
  const { panel, panelTitle, panelEntityId } = input
  if (
    panel !== 'dashboard' &&
    panel !== 'inbox' &&
    panel !== 'issues' &&
    panel !== 'issue-detail' &&
    panel !== 'chat' &&
    panel !== 'skill-editor' &&
    panel !== 'capabilities'
  ) {
    return null
  }

  return {
    kind: panel,
    title: panelTitle || 'Panel',
    ...(panelEntityId ? { entityId: panelEntityId } : {}),
  }
}

function getCanonicalPanelId(panel: WorkspacePanelInput) {
  if (singletonKinds.has(panel.kind)) {
    return `${panel.kind}:singleton`
  }

  if (panel.entityId) {
    return `${panel.kind}:${panel.entityId}`
  }

  return `${panel.kind}:${panel.title}`
}

function arePanelsEqual(
  left: WorkspacePanelInput | null,
  right: WorkspacePanelInput | null,
) {
  if (left === right) return true
  if (!left || !right) return left === right
  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.entityId === right.entityId
  )
}

function getStoredPanelParams(
  params: WorkspacePanelParams | undefined,
  fallbackTitle: string,
) {
  if (!params) {
    return {
      kind: 'issues' as const,
      title: fallbackTitle,
      canonicalId: getCanonicalPanelId({ kind: 'issues', title: fallbackTitle }),
    }
  }

  return params
}

function getPanelParams(panel: DockPanelState) {
  return getStoredPanelParams(
    panel.params as WorkspacePanelParams | undefined,
    panel.title ?? panel.api.title ?? 'Panel',
  )
}

function readPinnedCanonicalIds(storageKey: string) {
  const raw = window.localStorage.getItem(storageKey)
  if (!raw) {
    return []
  }

  return Result.try(() => JSON.parse(raw))
    .andThen((parsed) =>
      Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
        ? Result.ok(parsed)
        : Result.err('invalid-pinned-tab-state'),
    )
    .tapError(() => {
      window.localStorage.removeItem(storageKey)
    })
    .match({
      ok: (ids) => [...new Set(ids)],
      err: () => [],
    })
}

function getPreferredPanelAfterRestore(api: DockviewApi) {
  const current = api.activeGroup?.activePanel ?? api.activePanel
  if (current) {
    return current
  }

  return (
    api.panels.find((candidate) => {
      const params = getPanelParams(candidate)
      return params.kind !== 'blank'
    }) ?? api.panels[0] ?? null
  )
}

function getPanelConstraints(kind: WorkspacePanelKind) {
  switch (kind) {
    case 'issues':
      return {
        minimumWidth: 540,
        minimumHeight: 320,
      }
    case 'dashboard':
      return {
        minimumWidth: 820,
        minimumHeight: 460,
      }
    case 'issue-detail':
      return {
        minimumWidth: 760,
        minimumHeight: 420,
      }
    case 'skill-editor':
      return {
        minimumWidth: 760,
        minimumHeight: 420,
      }
    case 'capabilities':
      return {
        minimumWidth: 640,
        minimumHeight: 360,
      }
    default:
      return {
        minimumWidth: 420,
        minimumHeight: 280,
      }
  }
}

function WorkspaceDockTab(props: React.ComponentProps<typeof DockviewDefaultTab>) {
  const ctx = useContext(WorkspaceDockContext)
  const panel = getStoredPanelParams(props.params, props.api.title ?? 'Panel')
  const Icon = panelIcons[panel.kind]
  const {
    api,
    hideClose,
    closeActionOverride,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    params: _params,
    containerApi,
    tabLocation: _tabLocation,
    className,
    ...domProps
  } = props
  const shouldHideClose = hideClose || panel.kind === 'blank'
  const isPinned = ctx?.isPanelPinned(api.id) ?? false

  const handleClose = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (closeActionOverride) {
      closeActionOverride()
      return
    }

    api.close()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            {...domProps}
            className={['dv-default-tab', 'garden-dock-tab', className]
              .filter(Boolean)
              .join(' ')}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
          />
        }
      >
        <span className="dv-default-tab-content">
          <span className="garden-dock-tab__label">
            <Icon className="size-3.5 shrink-0" />
            {isPinned ? (
              <Pin className="garden-dock-tab__pin size-3 shrink-0" />
            ) : null}
            <span className="truncate">{api.title ?? panel.title}</span>
          </span>
        </span>
        {!shouldHideClose ? (
          <div
            className="dv-default-tab-action"
            onPointerDown={(event) => {
              event.preventDefault()
            }}
            onClick={handleClose}
          >
            <X className="size-3.5" />
          </div>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent side="bottom">
        <ContextMenuItem
          onClick={() => {
            ctx?.togglePanelPinned(api.id)
          }}
        >
          {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {isPinned ? 'Unpin tab' : 'Pin tab'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            ctx?.splitPanel(api.id)
          }}
        >
          <Columns2 className="size-4" />
          Create split right
        </ContextMenuItem>
        {!shouldHideClose ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                const target = containerApi.getPanel(api.id)
                if (target && containerApi.activePanel?.id !== target.id) {
                  target.api.setActive()
                }
                api.close()
              }}
            >
              <X className="size-4" />
              Close tab
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

type WorkspaceDockControlsProps = {
  activePanelIsPinned?: boolean
  disabledAll?: boolean
  onMaximize?: () => void
  onTogglePinned?: () => void
  onSplitRight?: () => void
}

function WorkspaceDockControls({
  activePanelIsPinned = false,
  disabledAll = false,
  onMaximize,
  onTogglePinned,
  onSplitRight,
}: WorkspaceDockControlsProps) {
  const isDisabled = (handler?: () => void) => disabledAll || !handler

  return (
    <div className="garden-dock-actions">
      <button
        type="button"
        className="garden-dock-actions__button"
        disabled={isDisabled(onSplitRight)}
        onClick={onSplitRight}
        title="Split right"
      >
        <Columns2 className="size-3.5" />
      </button>
      <button
        type="button"
        className="garden-dock-actions__button"
        disabled={isDisabled(onMaximize)}
        onClick={onMaximize}
        title="Maximize group"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        className={['garden-dock-actions__button', activePanelIsPinned ? 'garden-dock-actions__button--active' : '']
          .filter(Boolean)
          .join(' ')}
        disabled={isDisabled(onTogglePinned)}
        onClick={onTogglePinned}
        title={activePanelIsPinned ? 'Unpin tab' : 'Pin tab'}
      >
        {activePanelIsPinned ? (
          <PinOff className="size-3.5" />
        ) : (
          <Pin className="size-3.5" />
        )}
      </button>
    </div>
  )
}

export function WorkspaceDockControlsStrip(
  _props?: IDockviewHeaderActionsProps,
) {
  const ctx = useContext(WorkspaceDockContext)

  if (!ctx) {
    return null
  }

  const {
    activeGroupId,
    activePanelIsPinned,
    splitActivePanel,
    maximizeActivePanel,
    toggleActivePanelPinned,
  } = ctx
  const hasActiveGroup = Boolean(activeGroupId)
  const hasActivePanel = Boolean(ctx.activePanel)

  return (
    <WorkspaceDockControls
      activePanelIsPinned={activePanelIsPinned}
      onMaximize={hasActiveGroup ? () => maximizeActivePanel() : undefined}
      onTogglePinned={hasActivePanel ? () => toggleActivePanelPinned() : undefined}
      onSplitRight={hasActivePanel ? () => splitActivePanel() : undefined}
    />
  )
}

export function WorkspaceDockTabStripActions(
  _props?: IDockviewHeaderActionsProps,
) {
  const ctx = useContext(WorkspaceDockContext)

  if (!ctx) {
    return null
  }

  const hasActiveGroup = Boolean(ctx.activeGroupId)

  return (
    <div className="garden-dock-tabstrip-actions">
      <button
        type="button"
        className="garden-dock-tabstrip-actions__button"
        disabled={!hasActiveGroup}
        onClick={() => {
          ctx.openBlankInActiveGroup()
        }}
        title="New tab"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

export function WorkspaceDockTitlebar({
  title: _title,
  subtitle: _subtitle,
}: {
  title?: string
  subtitle?: string
}) {
  const ctx = useContext(WorkspaceDockContext)
  const hasActiveGroup = Boolean(ctx?.activeGroupId)

  return (
    <div className="garden-titlebar">
      {!hasActiveGroup ? (
        <div className="garden-titlebar__fallback">
          <WorkspaceDockControls disabledAll />
        </div>
      ) : null}
    </div>
  )
}

function WorkspacePanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {children}
    </div>
  )
}

function BlankDockPanel({
  api,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-end px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            api.group.api.close()
          }}
        >
          Close group
        </Button>
      </div>
    </section>
  )
}

function InboxDockPanel() {
  return (
    <WorkspacePanelFrame>
      <InboxPage />
    </WorkspacePanelFrame>
  )
}

function DashboardDockPanel() {
  return (
    <WorkspacePanelFrame>
      <DashboardPage />
    </WorkspacePanelFrame>
  )
}

function IssuesDockPanel() {
  return (
    <WorkspacePanelFrame>
      <IssuesPage />
    </WorkspacePanelFrame>
  )
}

function IssueDetailDockPanel({
  params,
  api,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  if (!params.entityId) {
    return (
      <section className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Issue details need an issue id.
      </section>
    )
  }

  // TODO(realtime): when issue title updates arrive over realtime, sync the dock
  // tab and params instead of recreating the panel.
  //
  // api.setTitle(nextIssue.title)
  // api.updateParameters({
  //   ...params,
  //   title: nextIssue.title,
  //   entityId: nextIssue.id,
  // })

  void api

  return (
    <WorkspacePanelFrame>
      <IssueDetail issueId={params.entityId} />
    </WorkspacePanelFrame>
  )
}

function SkillsDockPanel() {
  return (
    <WorkspacePanelFrame>
      <SkillsPage />
    </WorkspacePanelFrame>
  )
}

function ChatDockPanel({
  api,
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  const handleSessionChange = useCallback(
    (session: { id: string; title: string }) => {
      const nextTitle = session.title.trim() || 'New Chat'
      const nextCanonicalId = getCanonicalPanelId({
        kind: 'chat',
        title: nextTitle,
        entityId: session.id,
      })
      if (
        params.entityId === session.id &&
        params.title === nextTitle &&
        params.canonicalId === nextCanonicalId
      ) {
        return
      }
      api.setTitle(nextTitle)
      api.updateParameters({
        ...params,
        title: nextTitle,
        entityId: session.id,
        canonicalId: nextCanonicalId,
      })
    },
    [api, params],
  )

  return (
    <WorkspacePanelFrame>
      <AgentInteractionScreen
        className="flex h-full min-h-0 flex-col bg-background"
        panelTitle={params.title}
        sessionId={params.entityId ?? null}
        onSessionChange={handleSessionChange}
      />
    </WorkspacePanelFrame>
  )
}

function CapabilitiesDockPanel({
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <WorkspacePanelFrame>
      <ConnectionsPage
        focusedConnectorId={
          params.entityId as
            | 'exa-search'
            | 'gmail'
            | 'google-drive'
            | 'slack'
            | 'github'
            | undefined
        }
      />
    </WorkspacePanelFrame>
  )
}

const dockComponents = {
  blank: BlankDockPanel,
  dashboard: DashboardDockPanel,
  inbox: InboxDockPanel,
  issues: IssuesDockPanel,
  'issue-detail': IssueDetailDockPanel,
  chat: ChatDockPanel,
  'skill-editor': SkillsDockPanel,
  capabilities: CapabilitiesDockPanel,
} satisfies Record<
  WorkspacePanelKind,
  React.FunctionComponent<IDockviewPanelProps<WorkspacePanelParams>>
>

type StoredDockviewPanelState = {
  contentComponent?: unknown
  params?: {
    kind?: unknown
  }
}

type StoredDockviewLayout = SerializedDockview

function isStoredDockviewLayout(value: unknown): value is StoredDockviewLayout {
  if (!value || typeof value !== 'object') {
    return false
  }

  const { grid, panels } = value as {
    grid?: unknown
    panels?: unknown
  }
  if (!grid || typeof grid !== 'object') {
    return false
  }

  if (!panels || typeof panels !== 'object') {
    return false
  }

  const entries = Object.values(panels)
  if (entries.length === 0) {
    return false
  }

  return entries.every((panel) => {
    if (!panel || typeof panel !== 'object') {
      return false
    }

    const component = (panel as StoredDockviewPanelState).contentComponent
    if (!isWorkspacePanelKind(component)) {
      return false
    }

    const params = (panel as StoredDockviewPanelState).params
    if (!params || typeof params !== 'object' || !('kind' in params)) {
      return false
    }

    return params.kind === component
  })
}

function readStoredDockviewLayout(storageKey: string) {
  const rawLayout = window.localStorage.getItem(storageKey)
  if (!rawLayout) {
    return null
  }

  return Result.try(() => JSON.parse(rawLayout))
    .andThen((parsed) =>
      isStoredDockviewLayout(parsed)
        ? Result.ok(parsed)
        : Result.err('invalid-dockview-layout'),
    )
    .tapError(() => {
      window.localStorage.removeItem(storageKey)
    })
    .match({
      ok: (layout) => layout,
      err: () => null,
    })
}

export function WorkspaceDockProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const [{ panel, panelEntityId, panelTitle }, setPanelQueryState] =
    useQueryStates({
      panel: parseAsString,
      panelTitle: parseAsString,
      panelEntityId: parseAsString,
    })
  const { resolvedTheme } = useTheme()
  const apiRef = useRef<DockviewApi | null>(null)
  const readyCleanupRef = useRef<(() => void) | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<WorkspacePanelInput | null>(
    null,
  )
  const [isReady, setIsReady] = useState(false)
  const [pinnedCanonicalIds, setPinnedCanonicalIds] = useState<string[]>([])

  const storageKey = `garden:dockview:${workspaceId}`
  const pinnedStorageKey = `garden:dockview:pinned:${workspaceId}`

  const dockTheme =
    resolvedTheme === 'dark'
      ? {
          ...themeDark,
          className: 'dockview-theme-dark garden-dock-theme',
        }
      : {
          ...themeLight,
          className: 'dockview-theme-light garden-dock-theme',
        }

  const getVisiblePanelFromApi = useCallback(
    (api: DockviewApi) => api.activeGroup?.activePanel ?? api.activePanel,
    [],
  )

  const getPanelInputFromApi = useCallback((api: DockviewApi) => {
    const panel = getVisiblePanelFromApi(api)
    if (!panel) return null
    const params = getPanelParams(panel)
    return {
      kind: params.kind,
      title: panel.title ?? panel.api.title ?? params.title,
      entityId: params.entityId,
    } satisfies WorkspacePanelInput
  }, [getVisiblePanelFromApi])

  const writePanelToQueryState = useCallback(
    (nextPanel: WorkspacePanelInput | null) => {
      if (
        panel === (nextPanel?.kind ?? null) &&
        panelTitle === (nextPanel?.title ?? null) &&
        panelEntityId === (nextPanel?.entityId ?? null)
      ) {
        return
      }
      void setPanelQueryState({
        panel: nextPanel?.kind ?? null,
        panelTitle: nextPanel?.title ?? null,
        panelEntityId: nextPanel?.entityId ?? null,
      })
    },
    [panel, panelEntityId, panelTitle, setPanelQueryState],
  )

  const commitActiveDockState = useCallback(
    (api: DockviewApi) => {
      const nextPanel = getPanelInputFromApi(api)
      const nextGroupId = api.activeGroup?.id ?? null
      setActiveGroupId((current) =>
        current === nextGroupId ? current : nextGroupId,
      )
      setActivePanel((current) =>
        arePanelsEqual(current, nextPanel) ? current : nextPanel,
      )
      setActiveSession(
        nextPanel?.kind === 'chat' ? nextPanel.entityId ?? null : null,
      )
      writePanelToQueryState(nextPanel)
      return nextPanel
    },
    [getPanelInputFromApi, setActiveSession, writePanelToQueryState],
  )

  const resolveCanonicalIdForPanel = useCallback((panelId: string) => {
    const panel = apiRef.current?.getPanel(panelId)
    if (!panel) return null
    return getPanelParams(panel).canonicalId
  }, [])

  const isPanelPinned = useCallback(
    (panelId: string) => {
      const canonicalId = resolveCanonicalIdForPanel(panelId)
      return canonicalId ? pinnedCanonicalIds.includes(canonicalId) : false
    },
    [pinnedCanonicalIds, resolveCanonicalIdForPanel],
  )

  const setPinnedIds = useCallback(
    (updater: (current: string[]) => string[]) => {
      setPinnedCanonicalIds((current) => {
        const next = [...new Set(updater(current))]
        if (next.length === 0) {
          window.localStorage.removeItem(pinnedStorageKey)
        } else {
          window.localStorage.setItem(pinnedStorageKey, JSON.stringify(next))
        }
        return next
      })
    },
    [pinnedStorageKey],
  )

  const togglePanelPinned = useCallback(
    (panelId: string) => {
      const canonicalId = resolveCanonicalIdForPanel(panelId)
      if (!canonicalId) return
      setPinnedIds((current) =>
        current.includes(canonicalId)
          ? current.filter((id) => id !== canonicalId)
          : [...current, canonicalId],
      )
    },
    [resolveCanonicalIdForPanel, setPinnedIds],
  )

  const toggleActivePanelPinned = useCallback(() => {
    const panelId = apiRef.current?.activePanel?.id
    if (!panelId) return
    togglePanelPinned(panelId)
  }, [togglePanelPinned])

  const addBlankPanelToGroup = useCallback(
    (
      groupId: string,
      options?: {
        activate?: boolean
      },
    ) => {
      const api = apiRef.current
      if (!api) return null

      const targetGroup = api.getGroup(groupId)
      if (!targetGroup) return null

      const id = nextDockPanelId('blank')
      const created = api.addPanel<WorkspacePanelParams>({
        id,
        component: 'blank',
        title: 'New Tab',
        params: {
          kind: 'blank',
          title: 'New Tab',
          canonicalId: id,
        },
        minimumWidth: 420,
        minimumHeight: 280,
        position: {
          referenceGroup: groupId,
          direction: 'within',
        },
      })

      const shouldActivate =
        options?.activate ?? (!api.activePanel || api.activeGroup?.id === groupId)

      if (shouldActivate) {
        created.api.setActive()
        commitActiveDockState(api)
      }

      return created.id
    },
    [commitActiveDockState],
  )

  const ensureEmptyGroupsHaveBlankPanel = useCallback((api: DockviewApi) => {
    for (const group of api.groups) {
      if (group.panels.length === 0) {
        addBlankPanelToGroup(group.id)
      }
    }
  }, [addBlankPanelToGroup])

  const openPanel = useCallback(
    (
      panel: WorkspacePanelInput,
      options?: { position?: AddPanelPositionOptions; forceNew?: boolean },
    ) => {
      const api = apiRef.current
      if (!api) return null

      const canonicalId = getCanonicalPanelId(panel)
      const existing =
        options?.forceNew === true
          ? undefined
          : api.panels.find((candidate) => {
              const params = getPanelParams(candidate)
              return params?.canonicalId === canonicalId
            })

      if (existing) {
        const existingParams = getPanelParams(existing)
        const entityChanged =
          panel.entityId !== undefined &&
          existingParams?.entityId !== panel.entityId
        if (entityChanged) {
          existing.api.updateParameters({
            ...existingParams,
            ...panel,
            canonicalId,
          } satisfies WorkspacePanelParams)
          if (panel.title && existing.title !== panel.title) {
            existing.api.setTitle(panel.title)
          }
        }
        existing.api.setActive()
        commitActiveDockState(api)
        return existing.id
      }

      const id = nextDockPanelId(panel.kind)
      const created = api.addPanel<WorkspacePanelParams>({
        id,
        component: panel.kind,
        title: panel.title,
        params: {
          ...panel,
          canonicalId,
        },
        ...getPanelConstraints(panel.kind),
        position: options?.position,
      })

      created.api.setActive()
      commitActiveDockState(api)
      return created.id
    },
    [commitActiveDockState],
  )

  const duplicateActivePanel = useCallback(() => {
    const api = apiRef.current
    const current = api?.activePanel
    if (!api || !current) return

    const params = getPanelParams(current)
    openPanel(
      {
        kind: params.kind,
        title: current.title ?? current.api.title ?? params.title,
        entityId: params.entityId,
      },
      {
        forceNew: true,
        position: {
          referencePanel: current,
          direction: 'right',
        },
      },
    )
  }, [openPanel])

  const splitPanel = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const current = api?.getPanel(panelId)
      if (!api || !current) return

      const params = getPanelParams(current)
      openPanel(
        {
          kind: params.kind,
          title: current.title ?? current.api.title ?? params.title,
          entityId: params.entityId,
        },
        {
          forceNew: true,
          position: {
            referencePanel: current,
            direction: 'right',
          },
        },
      )
    },
    [openPanel],
  )

  const maximizeActivePanel = useCallback(() => {
    const api = apiRef.current
    const current = api?.activeGroup
    if (!api || !current) return

    if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup()
      return
    }

    current.api.maximize()
  }, [])

  const openBlankInActiveGroup = useCallback(() => {
    const activeGroupId = apiRef.current?.activeGroup?.id
    if (!activeGroupId) return null

    return addBlankPanelToGroup(activeGroupId, { activate: true })
  }, [addBlankPanelToGroup])

  const activePanelIsPinned = useMemo(() => {
    const panelId = apiRef.current?.activePanel?.id
    return panelId ? isPanelPinned(panelId) : false
  }, [activePanel, isPanelPinned])

  const focusNextPanel = useCallback(() => {
    apiRef.current?.moveToNext({ includePanel: true })
  }, [])

  const focusPreviousPanel = useCallback(() => {
    apiRef.current?.moveToPrevious({ includePanel: true })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey

      if (!isMeta) return

      if (event.key === 'PageDown') {
        event.preventDefault()
        focusNextPanel()
        return
      }

      if (event.key === 'PageUp') {
        event.preventDefault()
        focusPreviousPanel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [focusNextPanel, focusPreviousPanel])

  useEffect(() => {
    setPinnedCanonicalIds(readPinnedCanonicalIds(pinnedStorageKey))
  }, [pinnedStorageKey])

  useEffect(() => {
    return () => {
      readyCleanupRef.current?.()
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      readyCleanupRef.current?.()
      const api = event.api
      apiRef.current = api
      setIsReady(true)

      const syncActiveDockState = () => {
        commitActiveDockState(api)
      }

      const ensureActivePanel = () => {
        const candidate = getPreferredPanelAfterRestore(api)
        if (!candidate) {
          return null
        }

        if (api.activePanel?.id !== candidate.id) {
          candidate.api.setActive()
        }

        return getPanelInputFromApi(api)
      }

      const saveLayout = () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }

        saveTimeoutRef.current = setTimeout(() => {
          window.localStorage.setItem(storageKey, JSON.stringify(api.toJSON()))
        }, 150)
      }

      const savedLayout = readStoredDockviewLayout(storageKey)
      const hasSavedLayout = Boolean(savedLayout)
      if (savedLayout) {
        api.fromJSON(savedLayout)

        if (api.panels.length === 0) {
          window.localStorage.removeItem(storageKey)
        }
      }

      ensureEmptyGroupsHaveBlankPanel(api)
      const searchPanel = readPanelFromQueryState({
        panel,
        panelTitle,
        panelEntityId,
      })
      if (searchPanel) {
        openPanel(searchPanel)
      } else if (!hasSavedLayout || api.panels.length === 0) {
        openPanel({ kind: 'inbox', title: 'Inbox' })
      }

      const settledPanel = ensureActivePanel()
      commitActiveDockState(api)
      writePanelToQueryState(settledPanel)

      const disposeActive = api.onDidActivePanelChange(() => {
        commitActiveDockState(api)
      })
      const disposeActiveGroup = api.onDidActiveGroupChange(() => {
        syncActiveDockState()
      })
      const disposeLayout = api.onDidLayoutChange(() => {
        ensureEmptyGroupsHaveBlankPanel(api)
        syncActiveDockState()
        saveLayout()
      })
      // Veto the top/bottom overlays during drag so horizontal stacking is
      // impossible — dropping on the top or bottom edge of a group does
      // nothing. Right/left/center drops still work.
      const disposeOverlay = api.onWillShowOverlay((event) => {
        if (event.position === 'bottom' || event.position === 'top') {
          event.preventDefault()
        }
      })

      readyCleanupRef.current = () => {
        disposeActive.dispose()
        disposeActiveGroup.dispose()
        disposeLayout.dispose()
        disposeOverlay.dispose()
      }
    },
    [
      commitActiveDockState,
      ensureEmptyGroupsHaveBlankPanel,
      getPanelInputFromApi,
      panel,
      panelEntityId,
      panelTitle,
      openPanel,
      storageKey,
      writePanelToQueryState,
    ],
  )

  const contextValue = useMemo<WorkspaceDockContextValue>(
    () => ({
      activeGroupId,
      activePanel,
      activePanelIsPinned,
      dockTheme,
      handleReady,
      isReady,
      openPanel,
      splitActivePanel: duplicateActivePanel,
      splitPanel,
      maximizeActivePanel,
      openBlankInActiveGroup,
      focusNextPanel,
      focusPreviousPanel,
      isPanelPinned,
      toggleActivePanelPinned,
      togglePanelPinned,
    }),
    [
      activeGroupId,
      activePanel,
      activePanelIsPinned,
      dockTheme,
      duplicateActivePanel,
      focusNextPanel,
      focusPreviousPanel,
      handleReady,
      isPanelPinned,
      isReady,
      maximizeActivePanel,
      openBlankInActiveGroup,
      openPanel,
      splitPanel,
      toggleActivePanelPinned,
      togglePanelPinned,
    ],
  )

  return (
    <WorkspaceDockContext.Provider value={contextValue}>
      {children}
    </WorkspaceDockContext.Provider>
  )
}

export function useWorkspaceDock() {
  const ctx = useContext(WorkspaceDockContext)
  if (!ctx) {
    throw new Error(
      'useWorkspaceDock must be used inside the workspace dock provider',
    )
  }
  return ctx
}

export function WorkspaceDockView() {
  const { dockTheme, handleReady } = useWorkspaceDock()

  return (
    <DockviewReact
      className="garden-dockview"
      components={dockComponents}
      defaultTabComponent={WorkspaceDockTab}
      leftHeaderActionsComponent={WorkspaceDockTabStripActions}
      prefixHeaderActionsComponent={WorkspaceDockControlsStrip}
      onReady={handleReady}
      singleTabMode="default"
      scrollbars="custom"
      tabAnimation="smooth"
      theme={dockTheme}
    />
  )
}
