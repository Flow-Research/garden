import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { Maximize2, Minimize2, Pin, Plus, X } from 'lucide-react'
import {
  Actions,
  DockLocation,
  Layout,
  Model,
  TabNode,
  TabSetNode,
  type BorderNode,
  type ILayoutApi,
  type ITabRenderValues,
  type ITabSetRenderValues,
} from 'flexlayout-react'
import {
  WorkspaceDockWatermark,
  WorkspaceTabSetToolbar,
} from './workspace-dock/chrome'
import {
  WorkspaceDockContext,
  useRequiredWorkspaceDock,
  useWorkspaceDock,
} from './workspace-dock/context'
import {
  hasChatSessionDragData,
  parseChatSessionDragPayload,
  chatSessionDragType,
} from './workspace-dock/drag'
import {
  createInitialModel,
  findActiveTabNode,
  findTabByCanonical,
  findTabByIdOrCanonical,
  findTabByReuseKey,
  findTabsByIdOrCanonical,
  getCanonicalPanelId,
  getParentTabSet,
  getTabConfig,
  getTargetTab,
  getTabNodes,
  getTargetTabSet,
  getStorageKey,
  panelToTabJson,
  persistModel,
  tabNodeToPanel,
  toPanelConfig,
  updateTabPanelConfig,
} from './workspace-dock/model'
import { panelIcons } from './workspace-dock/panel-icons'
import { WorkspacePanelFactory } from './workspace-dock/panels'
import type {
  OpenPanelOptions,
  WorkspaceDockContextValue,
  WorkspacePanelInput,
} from './workspace-dock/types'

export { chatSessionDragType, useRequiredWorkspaceDock, useWorkspaceDock }
export {
  getRailContextForPanel,
  railUsesContextRail,
} from './workspace-dock/types'
export type {
  OpenPanelOptions,
  WorkspaceDockContextValue,
  WorkspacePanelInput,
  WorkspacePanelKind,
  WorkspaceRailContext,
} from './workspace-dock/types'

/**
 * Own the FlexLayout model boundary for the workspace shell.
 *
 * FlexLayout is the tab source of truth: active tab, tab order, splits,
 * pinning, and panel config all live in the model JSON. React state only holds
 * the model instance plus a revision tick because FlexLayout mutates that model
 * in place after `Actions.*`. URL params and chat store state must not mirror
 * tab selection; sidebar and chat explorer highlights derive from this context.
 */
export function WorkspaceDockProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}) {
  const storageKey = getStorageKey(workspaceId)
  const layoutRef = useRef<ILayoutApi | null>(null)
  const [dockState, setDockState] = useState(() => ({
    workspaceId,
    model: createInitialModel(storageKey),
    revision: 0,
  }))

  const model = dockState.model

  useLayoutEffect(() => {
    if (dockState.workspaceId === workspaceId) return
    setDockState({
      workspaceId,
      model: createInitialModel(storageKey),
      revision: 0,
    })
  }, [dockState.workspaceId, storageKey, workspaceId])

  const activeTab = useMemo(
    () => findActiveTabNode(model),
    [model, dockState.revision],
  )
  const activePanel = useMemo(() => tabNodeToPanel(activeTab), [activeTab])

  const commitModel = useCallback(
    (nextModel: Model) => {
      persistModel(storageKey, nextModel)
      setDockState((current) =>
        current.model === nextModel
          ? { ...current, revision: current.revision + 1 }
          : current,
      )
    },
    [storageKey],
  )

  useLayoutEffect(() => {
    const listener = () => commitModel(model)
    model.addChangeListener(listener)
    return () => model.removeChangeListener(listener)
  }, [commitModel, model])

  const openPanel = useCallback(
    (nextPanel: WorkspacePanelInput, options?: OpenPanelOptions) => {
      const shouldReuse = !options?.forceNew
      const targetTab = getTargetTab(model, options?.targetPanelId)
      const targetConfig = getTabConfig(targetTab)
      const shouldReplaceTargetBlank =
        shouldReuse && targetTab && targetConfig?.kind === 'blank'

      if (shouldReplaceTargetBlank) {
        updateTabPanelConfig(model, targetTab, nextPanel)
        model.doAction(Actions.selectTab(targetTab.getId()))
        return targetTab.getId()
      }

      const existing = shouldReuse
        ? nextPanel.kind === 'chat'
          ? findTabByCanonical(model, getCanonicalPanelId(nextPanel))
          : findTabByReuseKey(model, nextPanel)
        : null

      if (existing) {
        updateTabPanelConfig(model, existing, nextPanel)
        model.doAction(Actions.selectTab(existing.getId()))
        return existing.getId()
      }

      const target = getTargetTabSet(model, options?.targetPanelId)
      if (!target) return null
      const added = model.doAction(
        Actions.addTab(
          panelToTabJson(nextPanel, { forceNew: options?.forceNew }),
          target.getId(),
          options?.splitRight ? DockLocation.RIGHT : DockLocation.CENTER,
          options?.index ?? -1,
          true,
        ),
      )
      return added instanceof TabNode ? added.getId() : null
    },
    [model],
  )

  const openPanelAt = useCallback(
    (
      nextPanel: WorkspacePanelInput,
      targetPanelId: string,
      direction: 'within' | 'right',
      index?: number,
    ) => {
      const existing =
        nextPanel.kind === 'chat'
          ? findTabByCanonical(model, getCanonicalPanelId(nextPanel))
          : findTabByReuseKey(model, nextPanel)
      const target = getTargetTabSet(model, targetPanelId)
      if (!target) return null

      if (existing) {
        updateTabPanelConfig(model, existing, nextPanel)
        model.doAction(
          Actions.moveNode(
            existing.getId(),
            target.getId(),
            direction === 'right' ? DockLocation.RIGHT : DockLocation.CENTER,
            index ?? -1,
            true,
          ),
        )
        return existing.getId()
      }

      return openPanel(nextPanel, {
        targetPanelId,
        splitRight: direction === 'right',
        index,
      })
    },
    [model, openPanel],
  )

  const activatePanel = useCallback(
    (panelId: string) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      if (!tab) return
      model.doAction(Actions.selectTab(tab.getId()))
    },
    [model],
  )

  const closePanel = useCallback(
    (panelId: string) => {
      for (const tab of findTabsByIdOrCanonical(model, panelId)) {
        model.doAction(Actions.deleteTab(tab.getId()))
      }
    },
    [model],
  )

  const openNewTab = useCallback(
    () => openPanel({ kind: 'blank', title: 'New Tab' }, { forceNew: true }),
    [openPanel],
  )

  const splitPanel = useCallback(
    (panelId: string) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      const panel = tabNodeToPanel(tab)
      if (!tab || !panel) return
      openPanel(panel, {
        forceNew: true,
        targetPanelId: tab.getId(),
        splitRight: true,
      })
    },
    [model, openPanel],
  )

  const isPanelExpanded = useCallback(
    (panelId: string) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      return getParentTabSet(tab)?.isMaximized() ?? false
    },
    [model, dockState.revision],
  )

  const togglePanelExpanded = useCallback(
    (panelId: string) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      const parent = getParentTabSet(tab)
      if (!parent) return
      model.doAction(Actions.maximizeToggle(parent.getId()))
    },
    [model],
  )

  const isPanelPinned = useCallback(
    (panelId: string) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      return getTabConfig(tab)?.pinned === true
    },
    [model, dockState.revision],
  )

  const togglePanelPinned = useCallback(
    (panelId: string) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      if (!tab) return
      const config = getTabConfig(tab)
      if (!config) return
      const pinned = config.pinned !== true
      model.doAction(
        Actions.updateNodeAttributes(tab.getId(), {
          enableClose: !pinned,
          config: {
            ...config,
            ...(pinned ? { pinned } : { pinned: undefined }),
          },
        }),
      )
    },
    [model],
  )

  const focusPanelByOffset = useCallback(
    (offset: number) => {
      const tabs = getTabNodes(model)
      if (tabs.length === 0) return
      const currentId = findActiveTabNode(model)?.getId()
      const currentIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.getId() === currentId),
      )
      const next = tabs[(currentIndex + offset + tabs.length) % tabs.length]
      if (next) model.doAction(Actions.selectTab(next.getId()))
    },
    [model],
  )

  const focusNextPanel = useCallback(
    () => focusPanelByOffset(1),
    [focusPanelByOffset],
  )
  const focusPreviousPanel = useCallback(
    () => focusPanelByOffset(-1),
    [focusPanelByOffset],
  )

  const updateChatPanelSession = useCallback(
    (panelId: string, session: { id: string; title: string }) => {
      const tab = findTabByIdOrCanonical(model, panelId)
      if (!tab) return
      const title = session.title.trim() || 'New Chat'
      updateTabPanelConfig(model, tab, {
        kind: 'chat',
        title,
        entityId: session.id,
      })
    },
    [model],
  )

  useLayoutEffect(() => {
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

  const value = useMemo<WorkspaceDockContextValue>(
    () => ({
      activePanel,
      activatePanel,
      closePanel,
      openPanel,
      openPanelAt,
      openNewTab,
      splitPanel,
      focusNextPanel,
      focusPreviousPanel,
      isPanelExpanded,
      isPanelPinned,
      togglePanelExpanded,
      togglePanelPinned,
      updateChatPanelSession,
    }),
    [
      activePanel,
      activatePanel,
      closePanel,
      focusNextPanel,
      focusPreviousPanel,
      isPanelExpanded,
      isPanelPinned,
      openNewTab,
      openPanel,
      openPanelAt,
      splitPanel,
      togglePanelExpanded,
      togglePanelPinned,
      updateChatPanelSession,
    ],
  )

  return (
    <WorkspaceDockContext.Provider value={value}>
      <WorkspaceDockModelContext.Provider
        value={{ model, revision: dockState.revision, layoutRef }}
      >
        {children}
      </WorkspaceDockModelContext.Provider>
    </WorkspaceDockContext.Provider>
  )
}

const WorkspaceDockModelContext = createContext<{
  model: Model
  revision: number
  layoutRef: MutableRefObject<ILayoutApi | null>
} | null>(null)

/** Wires FlexLayout's generic render/action hooks to Garden panels and chrome. */
export function WorkspaceDockView() {
  const dockModel = useContext(WorkspaceDockModelContext)
  const dock = useRequiredWorkspaceDock()
  if (!dockModel) return null
  const { model, layoutRef } = dockModel

  const factory = useCallback(
    (node: TabNode) => <WorkspacePanelFactory node={node} />,
    [],
  )

  const onRenderTab = useCallback(
    (node: TabNode, renderValues: ITabRenderValues) => {
      const panel =
        getTabConfig(node) ??
        toPanelConfig({ kind: 'blank', title: node.getName() })
      const Icon = panelIcons[panel.kind]
      renderValues.leading = <Icon className="garden-flexlayout-tab__icon" />
      renderValues.content = (
        <span className="garden-flexlayout-tab__content">
          {panel.pinned ? <Pin className="garden-flexlayout-tab__pin" /> : null}
          <span className="truncate">{node.getName() || panel.title}</span>
        </span>
      )
    },
    [],
  )

  const onRenderTabSet = useCallback(
    (node: TabSetNode | BorderNode, renderValues: ITabSetRenderValues) => {
      renderValues.leading = (
        <>
          {renderValues.leading}
          <WorkspaceTabSetToolbar key="workspace-actions" node={node} />
        </>
      )
    },
    [],
  )

  const onExternalDrag = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasChatSessionDragData(event.dataTransfer)) return undefined
    const session = parseChatSessionDragPayload(event.dataTransfer)
    if (!session) return undefined
    return {
      json: panelToTabJson({
        kind: 'chat',
        title: session.title,
        entityId: session.id,
      }),
    }
  }, [])

  const onAuxMouseClick = useCallback(
    (
      node: TabNode | TabSetNode | BorderNode,
      event: MouseEvent<HTMLElement>,
    ) => {
      if (!(node instanceof TabNode) || event.button !== 1) return
      event.preventDefault()
      dock.closePanel(node.getId())
    },
    [dock],
  )

  return (
    <div className="garden-flexlayout flex h-full min-h-0 flex-1">
      <Layout
        ref={layoutRef}
        model={model}
        factory={factory}
        onRenderTab={onRenderTab}
        onRenderTabSet={onRenderTabSet}
        onExternalDrag={onExternalDrag}
        onAuxMouseClick={onAuxMouseClick}
        onTabSetPlaceHolder={() => <WorkspaceDockWatermark />}
        realtimeResize
        icons={{
          close: <X className="size-3.5" />,
          maximize: <Maximize2 className="size-3.5" />,
          restore: <Minimize2 className="size-3.5" />,
          more: <Plus className="size-3.5 rotate-45" />,
        }}
        supportsPopout={false}
      />
    </div>
  )
}
