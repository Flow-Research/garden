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
  LayoutList,
  Maximize2,
  MessageSquare,
  PanelBottom,
  Plug,
  Plus,
  BookOpenText,
  Settings,
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
import { useTheme } from '@accelerate/ui/components/common/theme-provider'
import { Button } from '@accelerate/ui/components/ui/button'
import { InboxPage } from '@/features/inbox'
import { SettingsPage } from '@/features/settings'
import { SkillsPage } from '@/features/skills/components'
import { IssueDetail, IssuesPage } from '@/features/issues/components'
import { AgentInteractionScreen } from '@/features/chat/components/agent-interaction-screen'

export type WorkspacePanelKind =
  | 'blank'
  | 'inbox'
  | 'issues'
  | 'issue-detail'
  | 'chat'
  | 'skill-editor'
  | 'capabilities'
  | 'settings'

export type WorkspacePanelInput = {
  kind: WorkspacePanelKind
  title: string
  entityId?: string
}

type WorkspacePanelParams = WorkspacePanelInput & {
  canonicalId: string
}

type WorkspaceDockContextValue = {
  activeGroupId: string | null
  activePanel: WorkspacePanelInput | null
  activePanelIsSingleton: boolean
  dockTheme: DockviewTheme
  handleReady: (event: DockviewReadyEvent) => void
  isReady: boolean
  openPanel: (
    panel: WorkspacePanelInput,
    options?: { position?: AddPanelPositionOptions; forceNew?: boolean },
  ) => string | null
  splitActivePanel: (direction: 'right' | 'below') => void
  maximizeActivePanel: () => void
  openBlankInActiveGroup: () => string | null
  focusNextPanel: () => void
  focusPreviousPanel: () => void
}

const WorkspaceDockContext = createContext<WorkspaceDockContextValue | null>(
  null,
)

const singletonKinds = new Set<WorkspacePanelKind>([
  'inbox',
  'issues',
  'chat',
  'skill-editor',
  'capabilities',
  'settings',
])

const panelIcons: Record<
  WorkspacePanelKind,
  React.ComponentType<{ className?: string }>
> = {
  blank: File,
  inbox: Inbox,
  issues: LayoutList,
  'issue-detail': LayoutList,
  chat: MessageSquare,
  'skill-editor': BookOpenText,
  capabilities: Plug,
  settings: Settings,
}

let dockPanelCounter = 0

function nextDockPanelId(kind: WorkspacePanelKind) {
  dockPanelCounter += 1
  return `${kind}:${Date.now()}:${dockPanelCounter}`
}

function readPanelFromQueryState(input: {
  panel: string | null
  panelTitle: string | null
  panelEntityId: string | null
}): WorkspacePanelInput | null {
  const { panel, panelTitle, panelEntityId } = input
  if (
    panel !== 'inbox' &&
    panel !== 'issues' &&
    panel !== 'issue-detail' &&
    panel !== 'chat' &&
    panel !== 'skill-editor' &&
    panel !== 'capabilities' &&
    panel !== 'settings'
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
  if (panel.entityId) {
    return `${panel.kind}:${panel.entityId}`
  }

  if (singletonKinds.has(panel.kind)) {
    return `${panel.kind}:singleton`
  }

  return `${panel.kind}:${panel.title}`
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

function getPreferredPanelAfterRestore(api: DockviewApi) {
  const current = api.activePanel
  if (current) {
    return current
  }

  return (
    api.panels.find((candidate) => {
      const params = getStoredPanelParams(
        candidate.api.getParameters<WorkspacePanelParams>(),
        candidate.api.title ?? 'Panel',
      )
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
    case 'issue-detail':
      return {
        minimumWidth: 760,
        minimumHeight: 420,
      }
    case 'settings':
      return {
        minimumWidth: 720,
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
    containerApi: _containerApi,
    tabLocation: _tabLocation,
    className,
    ...domProps
  } = props
  const shouldHideClose = hideClose || panel.kind === 'blank'

  const handleClose = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (closeActionOverride) {
      closeActionOverride()
      return
    }

    api.close()
  }

  return (
    <div
      {...domProps}
      className={['dv-default-tab', 'accelerate-dock-tab', className]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      <span className="dv-default-tab-content">
        <span className="accelerate-dock-tab__label">
          <Icon className="size-3.5 shrink-0" />
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
    </div>
  )
}

type WorkspaceDockControlsProps = {
  activePanelIsSingleton?: boolean
  disabledAll?: boolean
  onMaximize?: () => void
  onSplitBelow?: () => void
  onSplitRight?: () => void
}

function WorkspaceDockControls({
  activePanelIsSingleton = false,
  disabledAll = false,
  onMaximize,
  onSplitBelow,
  onSplitRight,
}: WorkspaceDockControlsProps) {
  const isDisabled = (handler?: () => void) => disabledAll || !handler

  return (
    <div className="accelerate-dock-actions">
      <button
        type="button"
        className="accelerate-dock-actions__button"
        disabled={isDisabled(onSplitRight)}
        onClick={onSplitRight}
        title="Split right"
      >
        <Columns2 className="size-3.5" />
      </button>
      <button
        type="button"
        className="accelerate-dock-actions__button"
        disabled={isDisabled(onSplitBelow)}
        onClick={onSplitBelow}
        title="Split down"
      >
        <PanelBottom className="size-3.5" />
      </button>
      <button
        type="button"
        className="accelerate-dock-actions__button"
        disabled={isDisabled(onMaximize)}
        onClick={onMaximize}
        title="Maximize group"
      >
        <Maximize2 className="size-3.5" />
      </button>
      {!disabledAll && activePanelIsSingleton ? (
        <span className="accelerate-dock-actions__hint">pinned</span>
      ) : null}
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
    activePanelIsSingleton,
    splitActivePanel,
    maximizeActivePanel,
  } = ctx
  const hasActiveGroup = Boolean(activeGroupId)
  const hasActivePanel = Boolean(ctx.activePanel)

  return (
    <WorkspaceDockControls
      activePanelIsSingleton={activePanelIsSingleton}
      onMaximize={hasActiveGroup ? () => maximizeActivePanel() : undefined}
      onSplitBelow={hasActivePanel ? () => splitActivePanel('below') : undefined}
      onSplitRight={hasActivePanel ? () => splitActivePanel('right') : undefined}
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
    <div className="accelerate-dock-tabstrip-actions">
      <button
        type="button"
        className="accelerate-dock-tabstrip-actions__button"
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
    <div className="accelerate-titlebar">
      {!hasActiveGroup ? (
        <div className="accelerate-titlebar__fallback">
          <WorkspaceDockControls disabledAll />
        </div>
      ) : null}
    </div>
  )
}

function WorkspacePanelFrame({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-h-0 overflow-hidden">{children}</div>
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

function SettingsDockPanel() {
  return (
    <WorkspacePanelFrame>
      <SettingsPage />
    </WorkspacePanelFrame>
  )
}

function PlaceholderDockPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <section className="flex h-full flex-col gap-4 px-6 py-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" />
        <span>{title}</span>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">{body}</p>
    </section>
  )
}

function ChatDockPanel() {
  return (
    <WorkspacePanelFrame>
      <AgentInteractionScreen className="flex h-full min-h-0 flex-col bg-background" />
    </WorkspacePanelFrame>
  )
}

function CapabilitiesDockPanel() {
  return (
    <PlaceholderDockPanel
      icon={Plug}
      title="Connections"
      body="Connector-scoped permissions and typed tool controls will land here once the connections surface is wired into the new control plane."
    />
  )
}

const dockComponents = {
  blank: BlankDockPanel,
  inbox: InboxDockPanel,
  issues: IssuesDockPanel,
  'issue-detail': IssueDetailDockPanel,
  chat: ChatDockPanel,
  'skill-editor': SkillsDockPanel,
  capabilities: CapabilitiesDockPanel,
  settings: SettingsDockPanel,
} satisfies Record<
  WorkspacePanelKind,
  React.FunctionComponent<IDockviewPanelProps<WorkspacePanelParams>>
>

export function WorkspaceDockProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
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

  const storageKey = `accelerate:dockview:${workspaceId}`

  const dockTheme =
    resolvedTheme === 'dark'
      ? {
          ...themeDark,
          className: 'dockview-theme-dark accelerate-dock-theme',
        }
      : {
          ...themeLight,
          className: 'dockview-theme-light accelerate-dock-theme',
        }

  const getPanelInputFromApi = useCallback((api: DockviewApi) => {
    const panel = api.activePanel
    if (!panel) return null
    const params = panel.api.getParameters<WorkspacePanelParams>()
    return {
      kind: params.kind,
      title: panel.api.title ?? params.title,
      entityId: params.entityId,
    } satisfies WorkspacePanelInput
  }, [])

  const writePanelToQueryState = useCallback(
    (nextPanel: WorkspacePanelInput | null) => {
      void setPanelQueryState({
        panel: nextPanel?.kind ?? null,
        panelTitle: nextPanel?.title ?? null,
        panelEntityId: nextPanel?.entityId ?? null,
      })
    },
    [setPanelQueryState],
  )

  const commitActiveDockState = useCallback(
    (api: DockviewApi) => {
      const nextPanel = getPanelInputFromApi(api)
      setActiveGroupId(api.activeGroup?.id ?? null)
      setActivePanel(nextPanel)
      writePanelToQueryState(nextPanel)
      return nextPanel
    },
    [getPanelInputFromApi, writePanelToQueryState],
  )

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
              const params = getStoredPanelParams(
                candidate.api.getParameters<WorkspacePanelParams>(),
                candidate.api.title ?? 'Panel',
              )
              return params?.canonicalId === canonicalId
            })

      if (existing) {
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

  const duplicateActivePanel = useCallback(
    (direction: 'right' | 'below') => {
      const api = apiRef.current
      const current = api?.activePanel
      if (!api || !current) return

      const params = current.api.getParameters<WorkspacePanelParams>()
      openPanel(
        {
          kind: params.kind,
          title: current.api.title ?? params.title,
          entityId: params.entityId,
        },
        {
          forceNew: true,
          position: {
            referencePanel: current,
            direction,
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

  const activePanelIsSingleton = activePanel
    ? singletonKinds.has(activePanel.kind)
    : false

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
        setActiveGroupId(api.activeGroup?.id ?? null)
        setActivePanel(getPanelInputFromApi(api))
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

      const savedLayout = window.localStorage.getItem(storageKey)
      const hasSavedLayout = Boolean(savedLayout)
      if (savedLayout) {
        api.fromJSON(JSON.parse(savedLayout))
      }

      ensureEmptyGroupsHaveBlankPanel(api)
      const searchPanel = readPanelFromQueryState({
        panel,
        panelTitle,
        panelEntityId,
      })
      if (searchPanel) {
        openPanel(searchPanel)
      } else if (!hasSavedLayout) {
        openPanel({ kind: 'inbox', title: 'Inbox' })
      }

      const settledPanel = ensureActivePanel()
      syncActiveDockState()
      writePanelToQueryState(settledPanel)

      const disposeActive = api.onDidActivePanelChange(() => {
        syncActiveDockState()
        writePanelToQueryState(getPanelInputFromApi(api))
      })
      const disposeActiveGroup = api.onDidActiveGroupChange(() => {
        syncActiveDockState()
      })
      const disposeLayout = api.onDidLayoutChange(() => {
        ensureEmptyGroupsHaveBlankPanel(api)
        syncActiveDockState()
        saveLayout()
      })

      readyCleanupRef.current = () => {
        disposeActive.dispose()
        disposeActiveGroup.dispose()
        disposeLayout.dispose()
      }
    },
    [
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
      activePanelIsSingleton,
      dockTheme,
      handleReady,
      isReady,
      openPanel,
      splitActivePanel: duplicateActivePanel,
      maximizeActivePanel,
      openBlankInActiveGroup,
      focusNextPanel,
      focusPreviousPanel,
    }),
    [
      activeGroupId,
      activePanel,
      activePanelIsSingleton,
      dockTheme,
      duplicateActivePanel,
      focusNextPanel,
      focusPreviousPanel,
      handleReady,
      isReady,
      maximizeActivePanel,
      openBlankInActiveGroup,
      openPanel,
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
      className="accelerate-dockview"
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
