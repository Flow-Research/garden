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
  Zap,
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
import { useWorkspaceStore } from '@garden/core/workspace'
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
import { AutomationDetailPage, AutomationsPage } from '@/features/automations'

export type WorkspacePanelKind =
  | 'blank'
  | 'dashboard'
  | 'inbox'
  | 'issues'
  | 'issue-detail'
  | 'automations'
  | 'automation-detail'
  | 'chat'
  | 'skill-editor'
  | 'capabilities'
  | 'agents'
  | 'agent-detail'

export type WorkspaceRailContext =
  | 'home'
  | 'chats'
  | 'tasks'
  | 'automations'
  | 'inbox'
  | 'agents'
  | 'skills'
  | 'connections'

export type WorkspacePanelInput = {
  kind: WorkspacePanelKind
  title: string
  entityId?: string
}

type BlankPanelChoice = WorkspacePanelInput & {
  description: string
  forceNew?: boolean
}

type OpenPanelSource = 'local' | 'query'

type OpenPanelOptions = {
  position?: AddPanelPositionOptions
  forceNew?: boolean
  source?: OpenPanelSource
}

const workspacePanelKinds = [
  'blank',
  'dashboard',
  'inbox',
  'issues',
  'issue-detail',
  'automations',
  'automation-detail',
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

type WorkspaceDockStateContextValue = {
  activeGroupId: string | null
  activePanel: WorkspacePanelInput | null
}

type WorkspaceDockContextValue = {
  dockTheme: DockviewTheme
  getDockApi: () => DockviewApi | null
  handleReady: (event: DockviewReadyEvent) => void
  isReady: boolean
  activatePanel: (panelId: string) => void
  closePanel: (panelId: string) => void
  openPanel: (
    panel: WorkspacePanelInput,
    options?: OpenPanelOptions,
  ) => string | null
  openPanelAt: (
    panel: WorkspacePanelInput,
    targetPanelId: string,
    direction: 'within' | 'right',
    index?: number,
  ) => string | null
  openNewTab: () => string | null
  splitPanel: (panelId: string) => void
  focusNextPanel: () => void
  focusPreviousPanel: () => void
  isPanelExpanded: (panelId: string) => boolean
  isPanelPinned: (panelId: string) => boolean
  togglePanelExpanded: (panelId: string) => void
  togglePanelPinned: (panelId: string) => void
}

const WorkspaceDockContext = createContext<WorkspaceDockContextValue | null>(
  null,
)
const WorkspaceDockStateContext =
  createContext<WorkspaceDockStateContextValue | null>(null)

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

function hasChatSessionDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(chatSessionDragType)
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
  'automations',
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
  automations: Zap,
  'automation-detail': Zap,
  chat: MessageSquare,
  'skill-editor': BookOpenText,
  capabilities: Plug,
  agents: Users,
  'agent-detail': Bot,
}

export function getRailContextForPanel(
  kind: WorkspacePanelKind | null | undefined,
): WorkspaceRailContext {
  switch (kind) {
    case 'chat':
      return 'chats'
    case 'issues':
    case 'issue-detail':
      return 'tasks'
    case 'automations':
    case 'automation-detail':
      return 'automations'
    case 'inbox':
      return 'inbox'
    case 'agents':
    case 'agent-detail':
      return 'agents'
    case 'skill-editor':
      return 'skills'
    case 'capabilities':
      return 'connections'
    case 'blank':
    case 'dashboard':
    default:
      return 'home'
  }
}

export function railUsesContextRail(rail: WorkspaceRailContext): boolean {
  return (
    rail === 'home' ||
    rail === 'chats' ||
    rail === 'skills' ||
    rail === 'agents' ||
    rail === 'connections'
  )
}

function panelUsesContextRail(kind: WorkspacePanelKind | null | undefined) {
  return railUsesContextRail(getRailContextForPanel(kind))
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
    panel !== 'automations' &&
    panel !== 'automation-detail' &&
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

function readPanelFromSearchState(input: {
  chat: string | null
  panel: string | null
  panelTitle: string | null
  panelEntityId: string | null
}): WorkspacePanelInput | null {
  return input.chat
    ? { kind: 'chat', title: 'Chat', entityId: input.chat }
    : readPanelFromQueryState(input)
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

function normalizePanelForSearch(panel: WorkspacePanelInput | null) {
  return panel?.kind === 'blank' ? null : panel
}

function arePanelSearchTargetsEqual(
  left: WorkspacePanelInput | null,
  right: WorkspacePanelInput | null,
) {
  const normalizedLeft = normalizePanelForSearch(left)
  const normalizedRight = normalizePanelForSearch(right)
  if (normalizedLeft === normalizedRight) return true
  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft === normalizedRight
  }
  return (
    normalizedLeft.kind === normalizedRight.kind &&
    normalizedLeft.entityId === normalizedRight.entityId
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
    case 'dashboard':
      return { minimumWidth: 420, minimumHeight: 280 }
    case 'issue-detail':
    case 'automation-detail':
    case 'skill-editor':
    case 'agents':
    case 'agent-detail':
    case 'capabilities':
      return { minimumWidth: 320, minimumHeight: 220 }
    case 'issues':
    case 'automations':
      return { minimumWidth: 280, minimumHeight: 200 }
    default:
      return { minimumWidth: 240, minimumHeight: 180 }
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
              if (!hasChatSessionDragData(event.dataTransfer)) return
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
        <span
          aria-hidden="true"
          className="garden-dock-tab__shoulder garden-dock-tab__shoulder--left"
        />
        <span
          aria-hidden="true"
          className="garden-dock-tab__shoulder garden-dock-tab__shoulder--right"
        />
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
          disabled={!ctx || containerApi.groups.length >= 2}
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

export function WorkspaceDockControlsStrip(
  props?: IDockviewHeaderActionsProps,
) {
  const ctx = useContext(WorkspaceDockContext)
  const workspaceSidebar = useSidebar()

  if (!ctx || !props) {
    return null
  }

  const { activePanel, containerApi } = props
  const activePanelParams = activePanel ? getPanelParams(activePanel) : null
  const hasActivePanel = Boolean(activePanel)
  const hasActiveGroup = Boolean(props.group)
  const activePanelIsExpanded = activePanel
    ? activePanel.group.api.isMaximized()
    : false
  const activePanelIsPinned = activePanel
    ? ctx.isPanelPinned(activePanel.id)
    : false
  const canUseContextRail = panelUsesContextRail(activePanelParams?.kind)
  const railOpen = workspaceSidebar.state === 'expanded'
  const canSplit = hasActivePanel && containerApi.groups.length < 2

  return (
    <div className="garden-dock-actions">
      <button
        type="button"
        className={cn(
          'garden-dock-actions__button',
          'garden-dock-actions__button--context-rail',
          railOpen && 'garden-dock-actions__button--active',
        )}
        disabled={!canUseContextRail}
        onClick={workspaceSidebar.toggleSidebar}
        title={
          canUseContextRail
            ? railOpen
              ? 'Collapse context rail'
              : 'Open context rail'
            : 'No context rail for this page'
        }
        aria-label={railOpen ? 'Collapse context rail' : 'Open context rail'}
      >
        <PanelLeft className="size-3.5" />
      </button>
      <button
        type="button"
        className="garden-dock-actions__button"
        disabled={!canSplit}
        onClick={
          canSplit && activePanel
            ? () => ctx.splitPanel(activePanel.id)
            : undefined
        }
        title="Split right"
      >
        <Columns2 className="size-3.5" />
      </button>
      <button
        type="button"
        className="garden-dock-actions__button"
        disabled={!hasActiveGroup}
        onClick={
          hasActivePanel && activePanel
            ? () => ctx.togglePanelExpanded(activePanel.id)
            : undefined
        }
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
        className={cn(
          'garden-dock-actions__button',
          activePanelIsPinned && 'garden-dock-actions__button--active',
        )}
        disabled={!hasActivePanel}
        onClick={
          hasActivePanel && activePanel
            ? () => ctx.togglePanelPinned(activePanel.id)
            : undefined
        }
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

export function WorkspaceDockTabStripActions(
  props?: IDockviewHeaderActionsProps,
) {
  const ctx = useContext(WorkspaceDockContext)

  if (!ctx || !props) {
    return null
  }

  const hasGroup = Boolean(props.group)

  return (
    <div className="garden-dock-tabstrip-actions">
      <button
        type="button"
        className="garden-dock-tabstrip-actions__button"
        disabled={!hasGroup}
        onClick={() => {
          ctx.openPanel(
            { kind: 'blank', title: 'New Tab' },
            {
              forceNew: true,
              position: {
                referenceGroup: props.group.id,
                direction: 'within',
              },
            },
          )
        }}
        title="New tab"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

function WorkspaceDockWatermark() {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const ctx = useContext(WorkspaceDockContext)

  return (
    <div className="garden-dock-watermark">
      <div className="garden-dock-watermark__copy">
        <span className="garden-dock-watermark__eyebrow">Workspace</span>
        <h2>{workspace?.name ?? 'Garden'}</h2>
        <p>Open a tab from the rail or use the new-tab button above.</p>
      </div>
      {ctx ? (
        <div className="garden-dock-watermark__actions">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => ctx.openNewTab()}
          >
            <Plus className="size-3.5" />
            New tab
          </Button>
        </div>
      ) : null}
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
  const canExpand = Boolean(
    ctx && panelId && (ctx.getDockApi()?.groups.length ?? 0) > 1 && !isExpanded,
  )
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasChatSessionDragData(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!ctx || !panelId || !hasChatSessionDragData(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)

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
        if (!hasChatSessionDragData(event.dataTransfer)) return
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
    kind: 'automations',
    title: 'Automations',
    description: 'Recurring schedules for agent work',
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

function AutomationsDockPanel({
  api,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  const ctx = useContext(WorkspaceDockContext)

  return (
    <WorkspacePanelFrame panelId={api.id}>
      <AutomationsPage
        onOpenAutomation={(automation) => {
          ctx?.openPanel({
            kind: 'automation-detail',
            title: automation.title,
            entityId: automation.id,
          })
        }}
      />
    </WorkspacePanelFrame>
  )
}

function AutomationDetailDockPanel({
  api,
  params,
}: IDockviewPanelProps<WorkspacePanelParams>) {
  const ctx = useContext(WorkspaceDockContext)

  if (!params.entityId) {
    return (
      <section className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Automation details need an automation id.
      </section>
    )
  }

  return (
    <WorkspacePanelFrame panelId={api.id}>
      <AutomationDetailPage
        automationId={params.entityId}
        onBack={() =>
          ctx?.openPanel({ kind: 'automations', title: 'Automations' })
        }
        onDeleted={() => {
          ctx?.openPanel({ kind: 'automations', title: 'Automations' })
          api.close()
        }}
      />
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
      if (
        api.isActive &&
        useChatStore.getState().activeSessionId !== session.id
      ) {
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
  automations: AutomationsDockPanel,
  'automation-detail': AutomationDetailDockPanel,
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
  const setVisibleChatSessions = useChatStore(
    (state) => state.setVisibleChatSessions,
  )
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
    options?: OpenPanelOptions
  } | null>(null)
  const staleSearchPanelRef = useRef<WorkspacePanelInput | null | undefined>(
    undefined,
  )
  const readyCleanupRef = useRef<(() => void) | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activePanel, setActivePanel] = useState<WorkspacePanelInput | null>(
    () =>
      readPanelFromSearchState({
        chat,
        panel,
        panelTitle,
        panelEntityId,
      }),
  )
  const activePanelRef = useRef(activePanel)
  activePanelRef.current = activePanel
  const [isReady, setIsReady] = useState(false)
  const [pinnedCanonicalIds, setPinnedCanonicalIds] = useState<string[]>([])

  const storageKey = `garden:dockview:${workspaceId}`
  const pinnedStorageKey = `garden:dockview:pinned:${workspaceId}`

  const requestedSearchPanel = useMemo(
    () =>
      readPanelFromSearchState({
        chat,
        panel,
        panelTitle,
        panelEntityId,
      }),
    [chat, panel, panelEntityId, panelTitle],
  )

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

  const syncVisibleChatSessions = useCallback(
    (api: DockviewApi) => {
      const visiblePanels =
        api.hasMaximizedGroup() && api.activeGroup
          ? [api.activeGroup.activePanel ?? api.activeGroup.panels[0]]
          : api.groups.map((group) => group.activePanel ?? group.panels[0])
      const visibleChatSessionIds = [
        ...new Set(
          visiblePanels.flatMap((panel) => {
            if (!panel) return []
            const params = getPanelParams(panel)
            return params.kind === 'chat' && params.entityId
              ? [params.entityId]
              : []
          }),
        ),
      ]
      setVisibleChatSessions(visibleChatSessionIds)
    },
    [setVisibleChatSessions],
  )

  const commitPanelState = useCallback(
    (
      nextPanel: WorkspacePanelInput | null,
      api?: DockviewApi,
      options?: { source?: OpenPanelSource },
    ) => {
      if (options?.source === 'query') {
        staleSearchPanelRef.current = undefined
      } else {
        staleSearchPanelRef.current =
          normalizePanelForSearch(requestedSearchPanel)
      }
      const nextActiveSessionId =
        nextPanel?.kind === 'chat' ? (nextPanel.entityId ?? null) : null
      const panelChanged = !arePanelsEqual(activePanelRef.current, nextPanel)
      const sessionChanged =
        useChatStore.getState().activeSessionId !== nextActiveSessionId
      if (panelChanged) {
        activePanelRef.current = nextPanel
        setActivePanel(nextPanel)
      }
      if (sessionChanged) {
        setActiveSession(nextActiveSessionId)
      }
      if (api) syncVisibleChatSessions(api)
      if (panelChanged || options?.source === 'query') {
        writePanelToQueryState(nextPanel)
      }
      return nextPanel
    },
    [
      requestedSearchPanel,
      setActiveSession,
      syncVisibleChatSessions,
      writePanelToQueryState,
    ],
  )

  const commitActiveDockState = useCallback(
    (api: DockviewApi, options?: { source?: OpenPanelSource }) =>
      commitPanelState(getPanelInputFromApi(api), api, options),
    [commitPanelState, getPanelInputFromApi],
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

  const openPanel = useCallback(
    (panel: WorkspacePanelInput, options?: OpenPanelOptions) => {
      const api = apiRef.current
      if (!api) {
        commitPanelState(panel, undefined, { source: options?.source })
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
        commitPanelState(
          {
            kind: panel.kind,
            title: existing.title ?? existing.api.title ?? existingParams.title,
            entityId: panel.entityId ?? existingParams.entityId,
          },
          api,
          { source: options?.source },
        )
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
      commitPanelState(panel, api, { source: options?.source })
      return created.id
    },
    [commitPanelState],
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
        commitPanelState(panel, api, { source: 'local' })
        return existing.id
      }
      return openPanel(panel, {
        position: { referencePanel: target, direction, index },
      })
    },
    [commitPanelState, openPanel],
  )

  const splitPanel = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const current = api?.getPanel(panelId)
      if (!api || !current || api.groups.length >= 2) return

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

  const togglePanelExpanded = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const panel = api?.getPanel(panelId)
      if (!api || !panel) return

      const isExpanded = panel.group.api.isMaximized()

      if (isExpanded) {
        panel.group.api.exitMaximized()
        commitActiveDockState(api)
        return
      }

      if (api.hasMaximizedGroup()) {
        api.exitMaximizedGroup()
      }

      panel.api.setActive()
      panel.group.api.maximize()
      commitActiveDockState(api)
    },
    [commitActiveDockState],
  )

  const dockActivePanel = apiRef.current
    ? getPanelInputFromApi(apiRef.current)
    : null
  const dockActivePanelKey = dockActivePanel
    ? `${dockActivePanel.kind}:${dockActivePanel.entityId ?? ''}:${dockActivePanel.title}`
    : null
  const contextActivePanel = useMemo(
    () => dockActivePanel ?? activePanel,
    [activePanel, dockActivePanelKey],
  )

  useEffect(() => {
    if (!isReady) return

    const staleSearchPanel = staleSearchPanelRef.current
    if (staleSearchPanel !== undefined) {
      const dockPanel = apiRef.current
        ? getPanelInputFromApi(apiRef.current)
        : null
      if (arePanelSearchTargetsEqual(dockPanel, requestedSearchPanel)) {
        staleSearchPanelRef.current = undefined
      } else if (
        arePanelSearchTargetsEqual(staleSearchPanel, requestedSearchPanel)
      ) {
        return
      } else {
        staleSearchPanelRef.current = undefined
      }
    }

    const queryPanel = requestedSearchPanel
    if (!queryPanel || arePanelSearchTargetsEqual(activePanel, queryPanel)) {
      return
    }

    commitPanelState(queryPanel, apiRef.current ?? undefined, {
      source: 'query',
    })
    openPanel(queryPanel, { source: 'query' })
  }, [
    activePanel,
    commitPanelState,
    getPanelInputFromApi,
    isReady,
    openPanel,
    requestedSearchPanel,
  ])

  const isPanelExpanded = useCallback(
    (panelId: string) => {
      const api = apiRef.current
      const panel = api?.getPanel(panelId)
      if (!api || !panel) return false
      return panel.group.api.isMaximized()
    },
    [],
  )

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

      const searchPanel = requestedSearchPanel
      const storedLayout = readStoredDockviewLayout(storageKey)
      const savedLayout = activatePanelInStoredLayout(storedLayout, searchPanel)
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
        commitPanelState(searchPanel, api, { source: 'query' })
        requestedPanelId = openPanel(searchPanel, { source: 'query' })
      } else if (!hasSavedLayout || api.panels.length === 0) {
        openPanel({ kind: 'inbox', title: 'Inbox' })
      }

      if (requestedPanelId) {
        const requestedPanel = api.getPanel(requestedPanelId)
        requestedPanel?.group.api.setActive()
        requestedPanel?.api.setActive()
        window.requestAnimationFrame(() => {
          const currentRequestedPanel = api.getPanel(requestedPanelId)
          if (!currentRequestedPanel) return
          currentRequestedPanel.group.api.setActive()
          currentRequestedPanel.api.setActive()
          commitPanelState(searchPanel, api, { source: 'query' })
        })
      }
      const settledPanel = requestedPanelId ? searchPanel : ensureActivePanel()
      if (requestedPanelId) {
        commitPanelState(settledPanel, api, { source: 'query' })
      } else {
        commitActiveDockState(api, { source: 'query' })
      }

      const pendingOpenPanel = pendingOpenPanelRef.current
      if (pendingOpenPanel) {
        pendingOpenPanelRef.current = null
        openPanel(pendingOpenPanel.panel, pendingOpenPanel.options)
      }

      const disposeActive = api.onDidActivePanelChange(() => {
        commitActiveDockState(api)
      })
      const disposeActiveGroup = api.onDidActiveGroupChange(() => {
        commitActiveDockState(api)
      })
      const disposeLayout = api.onDidLayoutChange(() => {
        syncVisibleChatSessions(api)
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
      commitPanelState,
      getPanelInputFromApi,
      syncVisibleChatSessions,
      openPanel,
      requestedSearchPanel,
      storageKey,
    ],
  )

  const stateValue = useMemo<WorkspaceDockStateContextValue>(
    () => ({
      activeGroupId: apiRef.current?.activeGroup?.id ?? null,
      activePanel: contextActivePanel,
    }),
    [contextActivePanel],
  )

  const contextValue = useMemo<WorkspaceDockContextValue>(
    () => ({
      activatePanel,
      closePanel,
      dockTheme,
      getDockApi: () => apiRef.current,
      handleReady,
      isReady,
      isPanelExpanded,
      openNewTab,
      openPanel,
      openPanelAt,
      splitPanel,
      focusNextPanel,
      focusPreviousPanel,
      togglePanelExpanded,
      isPanelPinned,
      togglePanelPinned,
    }),
    [
      activatePanel,
      closePanel,
      dockTheme,
      focusNextPanel,
      focusPreviousPanel,
      handleReady,
      isPanelExpanded,
      isPanelPinned,
      isReady,
      openNewTab,
      openPanel,
      openPanelAt,
      splitPanel,
      togglePanelExpanded,
      togglePanelPinned,
    ],
  )

  return (
    <WorkspaceDockContext.Provider value={contextValue}>
      <WorkspaceDockStateContext.Provider value={stateValue}>
        {children}
      </WorkspaceDockStateContext.Provider>
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
  const commands = useContext(WorkspaceDockContext)
  const state = useContext(WorkspaceDockStateContext)
  return useMemo(
    () => (commands && state ? { ...commands, ...state } : null),
    [commands, state],
  )
}

/**
 * Strict variant — throws when no provider. Use inside surfaces that are only
 * reachable from the real workspace shell (workspace dock view, headers,
 * shell-level controls).
 */
export function useRequiredWorkspaceDock() {
  const ctx = useWorkspaceDock()
  if (!ctx) {
    throw new Error(
      'useRequiredWorkspaceDock must be used inside the workspace dock provider',
    )
  }
  return ctx
}

export function WorkspaceDockView() {
  const dock = useContext(WorkspaceDockContext)

  if (!dock) return null

  const { dockTheme, handleReady } = dock

  return (
    <DockviewReact
      className="garden-dockview"
      components={dockComponents}
      defaultTabComponent={WorkspaceDockTab}
      leftHeaderActionsComponent={WorkspaceDockTabStripActions}
      prefixHeaderActionsComponent={WorkspaceDockControlsStrip}
      watermarkComponent={WorkspaceDockWatermark}
      disableFloatingGroups
      onReady={handleReady}
      singleTabMode="default"
      scrollbars="custom"
      tabAnimation="smooth"
      theme={dockTheme}
    />
  )
}
