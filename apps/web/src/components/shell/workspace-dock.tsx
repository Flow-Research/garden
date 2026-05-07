'use client'

import {
  Fragment,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { parseAsString, useQueryStates } from 'nuqs'
import {
  Bot,
  Columns2,
  File,
  Inbox,
  LayoutDashboard,
  LayoutList,
  Maximize2,
  Minimize2,
  PanelLeft,
  MessageSquare,
  Pin,
  PinOff,
  Plug,
  Plus,
  BookOpenText,
  Users,
  X,
} from 'lucide-react'
import {
  DockviewDefaultTab,
  DockviewReact,
  themeDark,
  themeLight,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewPanelRenderer,
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
import { useSidebar } from '@garden/ui/components/ui/sidebar'
import { cn } from '@garden/ui/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@garden/ui/components/ui/context-menu'
import { InboxPage } from '@/features/inbox'
import { SkillsPage } from '@/features/skills/components'
import { AgentsPage, AgentDetail } from '@/features/agents/components'
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
  | 'agents'
  | 'agent-detail'

export type WorkspacePanelInput = {
  kind: WorkspacePanelKind
  title: string
  entityId?: string
}

type BlankPanelChoice = WorkspacePanelInput & {
  description: string
  forceNew?: boolean
}

type WorkspaceDockTabState = {
  id: string
  kind: WorkspacePanelKind
  title: string
  entityId?: string
  isActive: boolean
  isPinned: boolean
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
  'agents',
  'agent-detail',
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
  activePanelIsExpanded: boolean
  activePanelIsPinned: boolean
  canSplitPanels: boolean
  dockTheme: DockviewTheme
  dockPanels: WorkspaceDockTabState[]
  groupCount: number
  getDockApi: () => DockviewApi | null
  handleReady: (event: DockviewReadyEvent) => void
  isReady: boolean
  activatePanel: (panelId: string) => void
  closePanel: (panelId: string) => void
  openPanel: (
    panel: WorkspacePanelInput,
    options?: { position?: AddPanelPositionOptions; forceNew?: boolean },
  ) => string | null
  openPanelAt: (
    panel: WorkspacePanelInput,
    targetPanelId: string,
    direction: 'within' | 'right',
    index?: number,
  ) => string | null
  openNewTab: () => string | null
  splitActivePanel: () => void
  splitPanel: (panelId: string) => void
  maximizeActivePanel: () => void
  focusNextPanel: () => void
  focusPreviousPanel: () => void
  isPanelExpanded: (panelId: string) => boolean
  isPanelPinned: (panelId: string) => boolean
  toggleActivePanelPinned: () => void
  togglePanelExpanded: (panelId: string) => void
  togglePanelPinned: (panelId: string) => void
}

const WorkspaceDockContext = createContext<WorkspaceDockContextValue | null>(
  null,
)

const dockPanelDragType = 'application/garden-dock-panel'
export const chatSessionDragType = 'application/garden-chat-session'

type ChatSessionDragPayload = {
  id: string
  title: string
}

function parseChatSessionDragPayload(
  dataTransfer: DataTransfer,
): ChatSessionDragPayload | null {
  const raw = dataTransfer.getData(chatSessionDragType)
  if (!raw) return null
  const parsed = Result.try(() => JSON.parse(raw) as unknown)
  if (Result.isError(parsed)) return null
  const value = parsed.value
  if (!value || typeof value !== 'object') return null
  const session = value as { id?: unknown; title?: unknown }
  if (typeof session.id !== 'string' || typeof session.title !== 'string') {
    return null
  }
  return { id: session.id, title: session.title }
}

function getDockPanelDragId(dataTransfer: DataTransfer) {
  return dataTransfer.getData(dockPanelDragType) || null
}

function hasDockDropData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).some(
    (type) => type === dockPanelDragType || type === chatSessionDragType,
  )
}

function getTabDropIndex(
  event: React.DragEvent<HTMLElement>,
  targetIndex: number,
) {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientX > rect.left + rect.width / 2
    ? targetIndex + 1
    : targetIndex
}

function normalizeMoveIndex(input: {
  draggedIndex: number
  insertIndex: number
}) {
  const { draggedIndex, insertIndex } = input
  return draggedIndex >= 0 && draggedIndex < insertIndex
    ? insertIndex - 1
    : insertIndex
}

const singletonKinds = new Set<WorkspacePanelKind>([
  'dashboard',
  'inbox',
  'issues',
  'skill-editor',
  'capabilities',
  'agents',
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
  agents: Users,
  'agent-detail': Bot,
}

function panelUsesContextRail(kind: WorkspacePanelKind | null | undefined) {
  return (
    kind === 'dashboard' ||
    kind === 'chat' ||
    kind === 'skill-editor' ||
    kind === 'agents' ||
    kind === 'agent-detail' ||
    kind === 'capabilities'
  )
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
    panel !== 'capabilities' &&
    panel !== 'agents' &&
    panel !== 'agent-detail'
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
      canonicalId: getCanonicalPanelId({
        kind: 'issues',
        title: fallbackTitle,
      }),
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
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string')
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
    }) ??
    api.panels[0] ??
    null
  )
}

/**
 * Per-panel mount strategy.
 *
 * Everything renders only while it's the active tab (`onlyWhenVisible`).
 *
 * Chat used to use `renderer: 'always'` so it stayed mounted across tab
 * switches. The cost was a Dockview `.dv-render-overlay` (absolute, z-index 1)
 * sitting in the gridview at all times — and that overlay leaked over the
 * left rail's chat-list explore menu, especially during sidebar collapse
 * animations where Dockview's RAF position recalc lagged behind the CSS
 * transition. The runtime/socket already lives above Dockview in
 * `ChatRuntimeProvider`, drafts are persisted in `chat-store`, so unmounting
 * the chat panel only loses scroll position — an acceptable trade for not
 * having a stray overlay paint over the sidebar.
 */
function getPanelRenderer(
  _kind: WorkspacePanelKind,
): DockviewPanelRenderer | undefined {
  return undefined
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
    case 'agents':
      return {
        minimumWidth: 720,
        minimumHeight: 420,
      }
    case 'agent-detail':
      return {
        minimumWidth: 720,
        minimumHeight: 420,
      }
    default:
      return {
        minimumWidth: 420,
        minimumHeight: 280,
      }
  }
}

function WorkspaceDockTab(
  props: React.ComponentProps<typeof DockviewDefaultTab>,
) {
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
  const shouldHideClose = hideClose
  const isPinned = ctx?.isPanelPinned(api.id) ?? false
  const targetIndex = api.group.panels.findIndex((panel) => panel.id === api.id)

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
            onDragOver={(event) => {
              if (!hasDockDropData(event.dataTransfer)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              const session = parseChatSessionDragPayload(event.dataTransfer)
              if (!session || !ctx) return
              event.preventDefault()
              event.stopPropagation()
              ctx.openPanelAt(
                { kind: 'chat', title: session.title, entityId: session.id },
                api.id,
                'within',
                getTabDropIndex(event, targetIndex >= 0 ? targetIndex : 0),
              )
            }}
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
          {isPinned ? (
            <PinOff className="size-4" />
          ) : (
            <Pin className="size-4" />
          )}
          {isPinned ? 'Unpin tab' : 'Pin tab'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!ctx?.canSplitPanels}
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
  activePanelIsExpanded?: boolean
  activePanelIsPinned?: boolean
  canSplitPanels?: boolean
  disabledAll?: boolean
  onMaximize?: () => void
  onTogglePinned?: () => void
  onSplitRight?: () => void
}

function WorkspaceDockControls({
  activePanelIsExpanded = false,
  activePanelIsPinned = false,
  canSplitPanels = true,
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
        disabled={disabledAll || !onSplitRight || !canSplitPanels}
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
        title={activePanelIsExpanded ? 'Restore split' : 'Expand tab'}
      >
        {activePanelIsExpanded ? (
          <Minimize2 className="size-3.5" />
        ) : (
          <Maximize2 className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        className={[
          'garden-dock-actions__button',
          activePanelIsPinned ? 'garden-dock-actions__button--active' : '',
        ]
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
    activePanelIsExpanded,
    activePanelIsPinned,
    canSplitPanels,
    splitActivePanel,
    maximizeActivePanel,
    toggleActivePanelPinned,
  } = ctx
  const hasActiveGroup = Boolean(activeGroupId)
  const hasActivePanel = Boolean(ctx.activePanel)

  return (
    <WorkspaceDockControls
      activePanelIsExpanded={activePanelIsExpanded}
      activePanelIsPinned={activePanelIsPinned}
      canSplitPanels={canSplitPanels}
      onMaximize={hasActiveGroup ? () => maximizeActivePanel() : undefined}
      onTogglePinned={
        hasActivePanel ? () => toggleActivePanelPinned() : undefined
      }
      onSplitRight={
        hasActivePanel && canSplitPanels ? () => splitActivePanel() : undefined
      }
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
          ctx.openNewTab()
        }}
        title="New tab"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

export function WorkspaceDockTitlebar({
  title,
  subtitle,
}: {
  title?: ReactNode
  subtitle?: ReactNode
}) {
  const ctx = useContext(WorkspaceDockContext)
  const workspaceSidebar = useSidebar()
  const hasActiveGroup = Boolean(ctx?.activeGroupId)

  if (!ctx) {
    return (
      <div className="garden-titlebar">
        <div className="garden-titlebar__fallback">
          <WorkspaceDockControls disabledAll />
          <div className="flex-1" />
        </div>
      </div>
    )
  }

  const hasActivePanel = Boolean(ctx.activePanel)
  const canUseContextRail = panelUsesContextRail(ctx.activePanel?.kind)
  const handleTabDrop = (
    event: React.DragEvent<HTMLDivElement>,
    targetPanelId: string,
  ) => {
    if (!hasDockDropData(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()

    const api = ctx.getDockApi()
    const targetPanel = api?.getPanel(targetPanelId)
    if (!api || !targetPanel) return
    const targetIndex = targetPanel.group.panels.findIndex(
      (panel) => panel.id === targetPanel.id,
    )
    const insertIndex = getTabDropIndex(
      event,
      targetIndex >= 0 ? targetIndex : 0,
    )

    const draggedPanelId = getDockPanelDragId(event.dataTransfer)
    if (draggedPanelId) {
      const draggedPanel = api.getPanel(draggedPanelId)
      if (!draggedPanel || draggedPanel.id === targetPanelId) return
      const draggedIndex = targetPanel.group.panels.findIndex(
        (panel) => panel.id === draggedPanel.id,
      )
      draggedPanel.api.moveTo({
        group: targetPanel.group,
        index: normalizeMoveIndex({ draggedIndex, insertIndex }),
      })
      draggedPanel.api.setActive()
      return
    }

    const session = parseChatSessionDragPayload(event.dataTransfer)
    if (!session) return
    ctx.openPanelAt(
      { kind: 'chat', title: session.title, entityId: session.id },
      targetPanelId,
      'within',
      insertIndex,
    )
  }

  const handleTabBarDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDockDropData(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()

    const api = ctx.getDockApi()
    const targetPanel = api?.activeGroup?.activePanel ?? api?.activePanel
    if (!api || !targetPanel) return
    const insertIndex = targetPanel.group.panels.length

    const draggedPanelId = getDockPanelDragId(event.dataTransfer)
    if (draggedPanelId) {
      const draggedPanel = api.getPanel(draggedPanelId)
      if (!draggedPanel) return
      const draggedIndex = targetPanel.group.panels.findIndex(
        (panel) => panel.id === draggedPanel.id,
      )
      draggedPanel.api.moveTo({
        group: targetPanel.group,
        index: normalizeMoveIndex({ draggedIndex, insertIndex }),
      })
      draggedPanel.api.setActive()
      return
    }

    const session = parseChatSessionDragPayload(event.dataTransfer)
    if (!session) return
    ctx.openPanelAt(
      { kind: 'chat', title: session.title, entityId: session.id },
      targetPanel.id,
      'within',
      insertIndex,
    )
  }

  return (
    <div className="garden-titlebar">
      <div className="garden-titlebar__fallback">
        <WorkspaceDockControls
          activePanelIsExpanded={ctx.activePanelIsExpanded}
          activePanelIsPinned={ctx.activePanelIsPinned}
          canSplitPanels={ctx.canSplitPanels}
          disabledAll={!hasActiveGroup}
          onMaximize={
            hasActiveGroup ? () => ctx.maximizeActivePanel() : undefined
          }
          onTogglePinned={
            hasActivePanel ? () => ctx.toggleActivePanelPinned() : undefined
          }
          onSplitRight={
            hasActivePanel && ctx.canSplitPanels
              ? () => ctx.splitActivePanel()
              : undefined
          }
        />
        <button
          type="button"
          className={[
            'garden-dock-actions__button',
            workspaceSidebar.state === 'expanded'
              ? 'garden-dock-actions__button--active'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!canUseContextRail}
          onClick={workspaceSidebar.toggleSidebar}
          title={
            canUseContextRail
              ? workspaceSidebar.state === 'expanded'
                ? 'Collapse context rail'
                : 'Open context rail'
              : 'No context rail for this page'
          }
          aria-label={
            workspaceSidebar.state === 'expanded'
              ? 'Collapse context rail'
              : 'Open context rail'
          }
        >
          <PanelLeft className="size-3.5" />
        </button>
        <div className="garden-titlebar__divider" aria-hidden="true" />
        {ctx.dockPanels.length > 0 ? (
          <div
            className="garden-titlebar__tabs"
            onDragOver={(event) => {
              if (!hasDockDropData(event.dataTransfer)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={handleTabBarDrop}
          >
            {ctx.dockPanels.map((tab, index) => {
              const Icon = panelIcons[tab.kind]

              return (
                <Fragment key={tab.id}>
                  <ContextMenu>
                    <ContextMenuTrigger render={<div className="contents" />}>
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        className={cn(
                          'garden-titlebar__tab',
                          tab.isActive && 'garden-titlebar__tab--active',
                        )}
                        onClick={() => {
                          ctx.activatePanel(tab.id)
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData(dockPanelDragType, tab.id)
                        }}
                        onDragOver={(event) => {
                          if (!hasDockDropData(event.dataTransfer)) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(event) => handleTabDrop(event, tab.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            ctx.activatePanel(tab.id)
                          }
                        }}
                        title={tab.title}
                      >
                        <span className="garden-titlebar__tab-label">
                          <Icon className="size-3 shrink-0" />
                          {tab.isPinned ? (
                            <Pin className="garden-dock-tab__pin size-3 shrink-0" />
                          ) : null}
                          <span className="truncate">{tab.title}</span>
                        </span>
                        <button
                          type="button"
                          role="button"
                          tabIndex={-1}
                          className="garden-titlebar__tab-close"
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            ctx.closePanel(tab.id)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              ctx.closePanel(tab.id)
                            }
                          }}
                        >
                          <X className="size-3" strokeWidth={2.2} />
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent side="bottom">
                      <ContextMenuItem
                        onClick={() => {
                          ctx.togglePanelPinned(tab.id)
                        }}
                      >
                        {tab.isPinned ? (
                          <PinOff className="size-4" />
                        ) : (
                          <Pin className="size-4" />
                        )}
                        {tab.isPinned ? 'Unpin tab' : 'Pin tab'}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        disabled={!ctx.canSplitPanels}
                        onClick={() => {
                          ctx.splitPanel(tab.id)
                        }}
                      >
                        <Columns2 className="size-4" />
                        Create split right
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => {
                          ctx.closePanel(tab.id)
                        }}
                      >
                        <X className="size-4" />
                        Close tab
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  {index < ctx.dockPanels.length - 1 ? (
                    <div
                      className="garden-titlebar__tab-divider"
                      aria-hidden="true"
                    />
                  ) : null}
                </Fragment>
              )
            })}
            <button
              type="button"
              className="garden-dock-tabstrip-actions__button shrink-0"
              disabled={!hasActiveGroup}
              onClick={() => {
                ctx.openNewTab()
              }}
              title="New tab"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="garden-titlebar__copy">
            <div className="garden-titlebar__title">{title}</div>
            {subtitle ? (
              <div className="garden-titlebar__subtitle">{subtitle}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkspacePanelFrame({
  children,
  panelId,
}: {
  children: React.ReactNode
  panelId?: string
}) {
  const ctx = useContext(WorkspaceDockContext)
  const isExpanded = panelId ? (ctx?.isPanelExpanded(panelId) ?? false) : false
  const canExpand = Boolean(ctx && panelId && ctx.groupCount > 1 && !isExpanded)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDockDropData(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!ctx || !panelId || !hasDockDropData(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)

    const draggedPanelId = getDockPanelDragId(event.dataTransfer)
    if (draggedPanelId && draggedPanelId !== panelId) {
      const api = ctx.getDockApi()
      const draggedPanel = api?.getPanel(draggedPanelId)
      const targetPanel = api?.getPanel(panelId)
      if (draggedPanel && targetPanel) {
        draggedPanel.api.moveTo({ group: targetPanel.group })
      }
      return
    }

    const session = parseChatSessionDragPayload(event.dataTransfer)
    if (!session) return
    ctx.openPanelAt(
      { kind: 'chat', title: session.title, entityId: session.id },
      panelId,
      'within',
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden',
        isDragOver && 'ring-2 ring-primary/45 ring-inset',
      )}
      onDragEnter={(event) => {
        if (!hasDockDropData(event.dataTransfer)) return
        setIsDragOver(true)
      }}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return
        }
        setIsDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {canExpand ? (
        <div className="pointer-events-none absolute top-3 right-3 z-20">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="pointer-events-auto size-7 rounded-none border-0 bg-transparent p-0 shadow-none"
            onClick={() => {
              if (!panelId) return
              ctx?.togglePanelExpanded(panelId)
            }}
            title={isExpanded ? 'Restore split' : 'Expand tab'}
          >
            {isExpanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  )
}

const blankPanelChoices: BlankPanelChoice[] = [
  {
    kind: 'dashboard',
    title: 'Dashboard',
    description: 'Home overview and workspace status',
  },
  {
    kind: 'inbox',
    title: 'Inbox',
    description: 'Approvals, mentions, and blockers',
  },
  {
    kind: 'issues',
    title: 'Tasks',
    description: 'Task list and issue detail flow',
  },
  {
    kind: 'chat',
    title: 'New Chat',
    description: 'Start a fresh chat tab',
    forceNew: true,
  },
  {
    kind: 'agents',
    title: 'Agents',
    description: 'Manage workspace agents and their skills',
  },
  {
    kind: 'skill-editor',
    title: 'Library',
    description: 'Browse and edit skills',
  },
  {
    kind: 'capabilities',
    title: 'Connections',
    description: 'Open connector setup and status',
  },
]

function BlankDockPanel({ api }: IDockviewPanelProps<WorkspacePanelParams>) {
  const ctx = useContext(WorkspaceDockContext)

  return (
    <WorkspacePanelFrame panelId={api.id}>
      <section className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex items-center justify-end px-3 py-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              api.close()
            }}
          >
            Close tab
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-3xl">
            <div className="mb-6">
              <p className="text-[11px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
                New Tab
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground">
                Choose what to open
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Pick a surface for this tab.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {blankPanelChoices.map((choice) => {
                const Icon = panelIcons[choice.kind]

                return (
                  <button
                    key={`${choice.kind}:${choice.title}`}
                    type="button"
                    className="flex min-h-28 flex-col items-start rounded-xl border border-border bg-card px-4 py-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40"
                    onClick={() => {
                      ctx?.openPanel(choice, {
                        forceNew: choice.forceNew,
                        position: {
                          referenceGroup: api.group.id,
                          direction: 'within',
                        },
                      })
                      api.close()
                    }}
                  >
                    <span className="mb-4 text-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {choice.title}
                    </span>
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">
                      {choice.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </WorkspacePanelFrame>
  )
}

function InboxDockPanel({ api }: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <WorkspacePanelFrame panelId={api.id}>
      <InboxPage />
    </WorkspacePanelFrame>
  )
}

function DashboardDockPanel({
  api,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <WorkspacePanelFrame panelId={api.id}>
      <DashboardPage />
    </WorkspacePanelFrame>
  )
}

function IssuesDockPanel({ api }: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <WorkspacePanelFrame panelId={api.id}>
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
    <WorkspacePanelFrame panelId={api.id}>
      <IssueDetail issueId={params.entityId} />
    </WorkspacePanelFrame>
  )
}

function SkillsDockPanel({
  api,
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <WorkspacePanelFrame panelId={api.id}>
      <SkillsPage focusedSkillId={params.entityId} />
    </WorkspacePanelFrame>
  )
}

function AgentsDockPanel({ api }: IDockviewPanelProps<WorkspacePanelParams>) {
  const ctx = useContext(WorkspaceDockContext)

  return (
    <WorkspacePanelFrame panelId={api.id}>
      <AgentsPage
        onOpenAgent={(agent) => {
          ctx?.openPanel({
            kind: 'agent-detail',
            title: agent.name,
            entityId: agent.id,
          })
        }}
      />
    </WorkspacePanelFrame>
  )
}

function AgentDetailDockPanel({
  api,
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  const ctx = useContext(WorkspaceDockContext)

  if (!params.entityId) {
    return (
      <section className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Agent details need an agent id.
      </section>
    )
  }

  return (
    <WorkspacePanelFrame panelId={api.id}>
      <AgentDetail
        agentId={params.entityId}
        onOpenSkill={(skillId, name) => {
          ctx?.openPanel({
            kind: 'skill-editor',
            title: 'Library',
            entityId: skillId,
          })
          void name
        }}
      />
    </WorkspacePanelFrame>
  )
}

function ChatDockPanel({
  api,
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  const setActiveSession = useChatStore((state) => state.setActiveSession)

  const handleSessionChange = useCallback(
    (session: { id: string; title: string }) => {
      const nextTitle = session.title.trim() || 'New Chat'
      const nextCanonicalId = getCanonicalPanelId({
        kind: 'chat',
        title: nextTitle,
        entityId: session.id,
      })
      if (api.isActive) {
        setActiveSession(session.id)
      }
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
    [api, params, setActiveSession],
  )

  return (
    <WorkspacePanelFrame panelId={api.id}>
      <AgentInteractionScreen
        key={params.entityId ?? api.id}
        className="flex h-full min-h-0 flex-col bg-background"
        panelTitle={params.title}
        sessionId={params.entityId ?? null}
        onSessionChange={handleSessionChange}
      />
    </WorkspacePanelFrame>
  )
}

function CapabilitiesDockPanel({
  api,
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <WorkspacePanelFrame panelId={api.id}>
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
  agents: AgentsDockPanel,
  'agent-detail': AgentDetailDockPanel,
} satisfies Record<
  WorkspacePanelKind,
  React.FunctionComponent<IDockviewPanelProps<WorkspacePanelParams>>
>

type StoredDockviewPanelState = {
  contentComponent?: unknown
  params?: {
    canonicalId?: unknown
    entityId?: unknown
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
      ok: (layout) => {
        const rootData = layout.grid.root.data
        if (!Array.isArray(rootData)) {
          window.localStorage.removeItem(storageKey)
          return null
        }

        const nextGroups = rootData
          .filter(
            (
              group,
            ): group is (typeof rootData)[number] & {
              data: { id: string; views: string[] }
            } => {
              const data = group.data
              return (
                Boolean(data) &&
                !Array.isArray(data) &&
                typeof data.id === 'string' &&
                Array.isArray(data.views)
              )
            },
          )
          .filter((group) => group.data.views.length > 0)
        if (nextGroups.length === 0) {
          window.localStorage.removeItem(storageKey)
          return null
        }

        return {
          ...layout,
          grid: {
            ...layout.grid,
            root: {
              ...layout.grid.root,
              data: nextGroups,
            },
          },
          activeGroup: nextGroups.some(
            (group) => group.data.id === layout.activeGroup,
          )
            ? layout.activeGroup
            : (nextGroups[0]?.data.id ?? null),
        }
      },
      err: () => null,
    })
}

function activatePanelInStoredLayout(
  layout: StoredDockviewLayout | null,
  panel: WorkspacePanelInput | null,
) {
  if (!layout) return null
  if (!panel) return layout

  const canonicalId = getCanonicalPanelId(panel)
  const targetPanelId = Object.entries(layout.panels).find(([, value]) => {
    const storedPanel = value as StoredDockviewPanelState
    return (
      storedPanel.params?.canonicalId === canonicalId ||
      (storedPanel.params?.kind === panel.kind &&
        storedPanel.params?.entityId === panel.entityId)
    )
  })?.[0]

  if (!targetPanelId) return layout

  const rootData = layout.grid.root.data
  if (!Array.isArray(rootData)) return layout

  let activeGroup: string | null = null
  const nextRootData = rootData.map((group) => {
    const data = group.data
    if (
      !data ||
      Array.isArray(data) ||
      typeof data.id !== 'string' ||
      !Array.isArray(data.views) ||
      !data.views.includes(targetPanelId)
    ) {
      return group
    }

    activeGroup = data.id
    return {
      ...group,
      data: {
        ...data,
        activeView: targetPanelId,
      },
    }
  })

  if (!activeGroup) return layout

  return {
    ...layout,
    activeGroup,
    grid: {
      ...layout.grid,
      root: {
        ...layout.grid.root,
        data: nextRootData,
      },
    },
  }
}

export function WorkspaceDockProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const [{ chat, panel, panelEntityId, panelTitle }, setPanelQueryState] =
    useQueryStates({
      chat: parseAsString,
      panel: parseAsString,
      panelTitle: parseAsString,
      panelEntityId: parseAsString,
    })
  const { resolvedTheme } = useTheme()
  const apiRef = useRef<DockviewApi | null>(null)
  const pendingOpenPanelRef = useRef<{
    panel: WorkspacePanelInput
    options?: { position?: AddPanelPositionOptions; forceNew?: boolean }
  } | null>(null)
  const readyCleanupRef = useRef<(() => void) | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<WorkspacePanelInput | null>(
    null,
  )
  const [groupCount, setGroupCount] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [maximizedGroupId, setMaximizedGroupId] = useState<string | null>(null)
  const [dockPanels, setDockPanels] = useState<WorkspaceDockTabState[]>([])
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

  const getPanelInputFromApi = useCallback(
    (api: DockviewApi) => {
      const panel = getVisiblePanelFromApi(api)
      if (!panel) return null
      const params = getPanelParams(panel)
      return {
        kind: params.kind,
        title: panel.title ?? panel.api.title ?? params.title,
        entityId: params.entityId,
      } satisfies WorkspacePanelInput
    },
    [getVisiblePanelFromApi],
  )

  const writePanelToQueryState = useCallback(
    (nextPanel: WorkspacePanelInput | null) => {
      const queryPanel = nextPanel?.kind === 'blank' ? null : nextPanel
      const chatId = queryPanel?.kind === 'chat' ? queryPanel.entityId : null
      const queryPanelTitle =
        queryPanel?.kind === 'chat' ? null : (queryPanel?.title ?? null)
      if (
        chat === chatId &&
        panel === (queryPanel?.kind ?? null) &&
        panelTitle === queryPanelTitle &&
        panelEntityId === (queryPanel?.entityId ?? null)
      ) {
        return
      }
      void setPanelQueryState({
        chat: chatId ?? null,
        panel: queryPanel?.kind ?? null,
        panelTitle: queryPanelTitle,
        panelEntityId: queryPanel?.entityId ?? null,
      })
    },
    [chat, panel, panelEntityId, panelTitle, setPanelQueryState],
  )

  const syncDockPanels = useCallback(
    (api: DockviewApi) => {
      const activePanelId =
        api.activeGroup?.activePanel?.id ?? api.activePanel?.id
      const orderedPanels = api.groups.flatMap((group) => group.panels)
      setDockPanels(
        orderedPanels.map((panel) => {
          const params = getPanelParams(panel)
          const title = panel.title ?? panel.api.title ?? params.title
          return {
            id: panel.id,
            kind: params.kind,
            title,
            entityId: params.entityId,
            isActive: panel.id === activePanelId,
            isPinned: pinnedCanonicalIds.includes(params.canonicalId),
          }
        }),
      )
    },
    [pinnedCanonicalIds],
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
      if (nextPanel?.kind === 'chat') {
        setActiveSession(nextPanel.entityId ?? null)
      }
      syncDockPanels(api)
      writePanelToQueryState(nextPanel)
      return nextPanel
    },
    [
      getPanelInputFromApi,
      setActiveSession,
      syncDockPanels,
      writePanelToQueryState,
    ],
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

  const activatePanel = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const panel = api?.getPanel(panelId)
      if (!api || !panel) return
      panel.group.api.setActive()
      panel.api.setActive()
      commitActiveDockState(api)
    },
    [commitActiveDockState],
  )

  const closePanel = useCallback((panelId: string) => {
    const panel = apiRef.current?.getPanel(panelId)
    if (!panel) return
    panel.api.close()
  }, [])

  const syncDockLayoutState = useCallback((api: DockviewApi) => {
    setGroupCount((current) =>
      current === api.groups.length ? current : api.groups.length,
    )
    if (api.groups.length <= 1) {
      setMaximizedGroupId(null)
    }
  }, [])

  const openPanel = useCallback(
    (
      panel: WorkspacePanelInput,
      options?: { position?: AddPanelPositionOptions; forceNew?: boolean },
    ) => {
      const api = apiRef.current
      if (!api) {
        pendingOpenPanelRef.current = { panel, options }
        return null
      }

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
        existing.group.api.setActive()
        existing.api.setActive()
        commitActiveDockState(api)
        return existing.id
      }

      const id = nextDockPanelId(panel.kind)
      const renderer = getPanelRenderer(panel.kind)
      const created = api.addPanel<WorkspacePanelParams>({
        id,
        component: panel.kind,
        title: panel.title,
        params: {
          ...panel,
          canonicalId,
        },
        ...(renderer ? { renderer } : {}),
        ...getPanelConstraints(panel.kind),
        position: options?.position,
      })

      created.group.api.setActive()
      created.api.setActive()
      commitActiveDockState(api)
      return created.id
    },
    [commitActiveDockState],
  )

  const openNewTab = useCallback(() => {
    return openPanel({ kind: 'blank', title: 'New Tab' }, { forceNew: true })
  }, [openPanel])

  const openPanelAt = useCallback(
    (
      panel: WorkspacePanelInput,
      targetPanelId: string,
      direction: 'within' | 'right',
      index?: number,
    ) => {
      const api = apiRef.current
      const target = api?.getPanel(targetPanelId)
      if (!api || !target) return null
      const canonicalId = getCanonicalPanelId(panel)
      const existing = api.panels.find((candidate) => {
        const params = getPanelParams(candidate)
        return params?.canonicalId === canonicalId
      })
      if (existing) {
        const existingIndex = target.group.panels.findIndex(
          (candidate) => candidate.id === existing.id,
        )
        existing.api.moveTo({
          group: target.group,
          index:
            index === undefined
              ? undefined
              : normalizeMoveIndex({
                  draggedIndex: existingIndex,
                  insertIndex: index,
                }),
        })
        existing.group.api.setActive()
        existing.api.setActive()
        commitActiveDockState(api)
        return existing.id
      }
      return openPanel(panel, {
        position: { referencePanel: target, direction, index },
      })
    },
    [commitActiveDockState, openPanel],
  )

  const canSplitPanels = groupCount < 2

  const duplicateActivePanel = useCallback(() => {
    const api = apiRef.current
    const current = api?.activePanel
    if (!api || !current || !canSplitPanels) return

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
  }, [canSplitPanels, openPanel])

  const splitPanel = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const current = api?.getPanel(panelId)
      if (!api || !current || !canSplitPanels) return

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
    [canSplitPanels, openPanel],
  )

  const togglePanelExpanded = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const panel = api?.getPanel(panelId)
      if (!api || !panel) return

      const nextGroupId = panel.group.id
      const isExpanded =
        maximizedGroupId === nextGroupId && api.hasMaximizedGroup()

      if (isExpanded) {
        api.exitMaximizedGroup()
        setMaximizedGroupId(null)
        commitActiveDockState(api)
        return
      }

      if (api.hasMaximizedGroup()) {
        api.exitMaximizedGroup()
      }

      panel.api.setActive()
      panel.group.api.maximize()
      setMaximizedGroupId(nextGroupId)
      commitActiveDockState(api)
    },
    [commitActiveDockState, maximizedGroupId],
  )

  const maximizeActivePanel = useCallback(() => {
    const api = apiRef.current
    const current = api?.activePanel
    if (!api || !current) return
    togglePanelExpanded(current.id)
  }, [togglePanelExpanded])

  useEffect(() => {
    if (!isReady) return

    const queryPanel = chat
      ? { kind: 'chat' as const, title: 'Chat', entityId: chat }
      : readPanelFromQueryState({
          panel,
          panelTitle,
          panelEntityId,
        })
    if (!queryPanel || arePanelsEqual(activePanel, queryPanel)) return

    openPanel(queryPanel)
  }, [
    activePanel,
    chat,
    isReady,
    openPanel,
    panel,
    panelEntityId,
    panelTitle,
  ])

  const activePanelIsPinned = useMemo(() => {
    const panelId = apiRef.current?.activePanel?.id
    return panelId ? isPanelPinned(panelId) : false
  }, [activePanel, isPanelPinned])

  const isPanelExpanded = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const panel = api?.getPanel(panelId)
      if (!api || !panel) return false
      return maximizedGroupId === panel.group.id && api.hasMaximizedGroup()
    },
    [maximizedGroupId],
  )

  const activePanelIsExpanded = useMemo(() => {
    const panelId = apiRef.current?.activePanel?.id
    return panelId ? isPanelExpanded(panelId) : false
  }, [activePanel, isPanelExpanded])

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
    const api = apiRef.current
    if (!api) return
    syncDockPanels(api)
  }, [pinnedCanonicalIds, syncDockPanels])

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

      const searchPanel = chat
        ? { kind: 'chat' as const, title: 'Chat', entityId: chat }
        : readPanelFromQueryState({
            panel,
            panelTitle,
            panelEntityId,
          })
      const storedLayout = readStoredDockviewLayout(storageKey)
      const savedLayout = activatePanelInStoredLayout(
        storedLayout,
        searchPanel,
      )
      const hasSavedLayout = Boolean(savedLayout)
      if (savedLayout) {
        api.fromJSON(savedLayout)

        if (api.panels.length === 0) {
          window.localStorage.removeItem(storageKey)
        }

        // Reconcile saved-layout renderers with the current strategy. Older
        // layouts persisted chat panels as `renderer: 'always'`, which left
        // a stray `.dv-render-overlay` painting over the sidebar's chat-list
        // explore menu. Downgrade those (and any other stale 'always' panel)
        // to the default `onlyWhenVisible`.
        for (const panel of api.panels) {
          const params = getPanelParams(panel)
          const desired = getPanelRenderer(params.kind) ?? 'onlyWhenVisible'
          if (panel.api.renderer !== desired) {
            panel.api.setRenderer(desired)
          }
        }
      }

      let requestedPanelId: string | null = null
      if (searchPanel) {
        requestedPanelId = openPanel(searchPanel)
      } else if (!hasSavedLayout || api.panels.length === 0) {
        openPanel({ kind: 'inbox', title: 'Inbox' })
      }

      syncDockLayoutState(api)
      if (requestedPanelId) {
        const requestedPanel = api.getPanel(requestedPanelId)
        requestedPanel?.group.api.setActive()
        requestedPanel?.api.setActive()
        window.requestAnimationFrame(() => {
          const currentRequestedPanel = api.getPanel(requestedPanelId)
          if (!currentRequestedPanel) return
          currentRequestedPanel.group.api.setActive()
          currentRequestedPanel.api.setActive()
          const active = commitActiveDockState(api)
          writePanelToQueryState(active)
        })
      }
      const settledPanel = requestedPanelId
        ? getPanelInputFromApi(api)
        : ensureActivePanel()
      commitActiveDockState(api)
      writePanelToQueryState(settledPanel)

      const pendingOpenPanel = pendingOpenPanelRef.current
      if (pendingOpenPanel) {
        pendingOpenPanelRef.current = null
        openPanel(pendingOpenPanel.panel, pendingOpenPanel.options)
        writePanelToQueryState(getPanelInputFromApi(api))
      }

      const disposeActive = api.onDidActivePanelChange(() => {
        commitActiveDockState(api)
      })
      const disposeActiveGroup = api.onDidActiveGroupChange(() => {
        syncActiveDockState()
      })
      const disposeLayout = api.onDidLayoutChange(() => {
        syncDockLayoutState(api)
        syncDockPanels(api)
        saveLayout()
      })
      // Veto the top/bottom overlays during drag so horizontal stacking is
      // impossible — dropping on the top or bottom edge of a group does
      // nothing. Right/left/center drops still work.
      const disposeOverlay = api.onWillShowOverlay((event) => {
        if (
          event.position === 'bottom' ||
          event.position === 'top' ||
          (api.groups.length >= 2 && event.position !== 'center')
        ) {
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
      chat,
      getPanelInputFromApi,
      syncDockLayoutState,
      syncDockPanels,
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
      activePanelIsExpanded,
      activePanelIsPinned,
      activatePanel,
      canSplitPanels,
      closePanel,
      dockTheme,
      dockPanels,
      getDockApi: () => apiRef.current,
      groupCount,
      handleReady,
      isReady,
      isPanelExpanded,
      openNewTab,
      openPanel,
      openPanelAt,
      splitActivePanel: duplicateActivePanel,
      splitPanel,
      maximizeActivePanel,
      focusNextPanel,
      focusPreviousPanel,
      togglePanelExpanded,
      isPanelPinned,
      toggleActivePanelPinned,
      togglePanelPinned,
    }),
    [
      activeGroupId,
      activePanel,
      activePanelIsExpanded,
      activePanelIsPinned,
      activatePanel,
      canSplitPanels,
      closePanel,
      dockTheme,
      dockPanels,
      duplicateActivePanel,
      focusNextPanel,
      focusPreviousPanel,
      groupCount,
      handleReady,
      isPanelExpanded,
      isPanelPinned,
      isReady,
      maximizeActivePanel,
      openNewTab,
      openPanel,
      openPanelAt,
      splitPanel,
      togglePanelExpanded,
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

/**
 * Read the workspace dock context. Returns null when no provider is mounted
 * (dev showcases, isolated tests). Callers that perform navigation should
 * optional-chain on the returned methods so they no-op when no dock exists,
 * rather than crash. Use `useRequiredWorkspaceDock` when the dock must exist.
 */
export function useWorkspaceDock() {
  return useContext(WorkspaceDockContext)
}

/**
 * Strict variant — throws when no provider. Use inside surfaces that are only
 * reachable from the real workspace shell (workspace dock view, headers,
 * shell-level controls).
 */
export function useRequiredWorkspaceDock() {
  const ctx = useContext(WorkspaceDockContext)
  if (!ctx) {
    throw new Error(
      'useRequiredWorkspaceDock must be used inside the workspace dock provider',
    )
  }
  return ctx
}

export function WorkspaceDockView() {
  const dock = useWorkspaceDock()

  if (!dock) return null

  const { dockTheme, handleReady } = dock

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
