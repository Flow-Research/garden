import {
  Actions,
  ICloseType,
  Model,
  TabNode,
  TabSetNode,
  type IJsonModel,
  type IJsonTabNode,
} from 'flexlayout-react'
import { Result } from 'better-result'
import {
  isWorkspacePanelKind,
  singletonKinds,
  type WorkspacePanelConfig,
  type WorkspacePanelInput,
} from './types'

let generatedPanelCounter = 0

/** Creates the stable product-level identity stored in FlexLayout tab config. */
export function getCanonicalPanelId(panel: WorkspacePanelInput) {
  if (singletonKinds.has(panel.kind)) return `${panel.kind}:singleton`
  if (panel.entityId) return `${panel.kind}:${panel.entityId}`
  return `${panel.kind}:${panel.title}`
}

/** Returns the runtime reuse bucket: chats stay per-session, other panels reuse by kind. */
export function getPanelReuseKey(
  panel: WorkspacePanelInput | WorkspacePanelConfig,
) {
  if (panel.kind === 'chat') return getCanonicalPanelId(panel)
  return panel.kind
}

/** Creates a unique FlexLayout node id for deliberate duplicate tabs/splits. */
function getNextPanelId(panel: WorkspacePanelInput) {
  generatedPanelCounter += 1
  return `${getCanonicalPanelId(panel)}:new:${Date.now()}:${generatedPanelCounter}`
}

/** Converts a Garden panel intent into the config stored on a FlexLayout tab. */
export function toPanelConfig(
  panel: WorkspacePanelInput,
  options?: { pinned?: boolean },
): WorkspacePanelConfig {
  return {
    kind: panel.kind,
    title: panel.title,
    canonicalId: getCanonicalPanelId(panel),
    ...(panel.entityId !== undefined ? { entityId: panel.entityId } : {}),
    ...(options?.pinned ? { pinned: true } : {}),
  }
}

/** Converts Garden panel input into the tab JSON FlexLayout actions consume. */
export function panelToTabJson(
  panel: WorkspacePanelInput,
  options?: { forceNew?: boolean; pinned?: boolean },
): IJsonTabNode {
  const config = toPanelConfig(panel, { pinned: options?.pinned })
  return {
    type: 'tab',
    id: options?.forceNew ? getNextPanelId(panel) : config.canonicalId,
    name: panel.title,
    component: panel.kind,
    closeType: ICloseType.Visible,
    enableClose: !config.pinned,
    enableRename: false,
    config,
  }
}

/**
 * Canonical FlexLayout global behavior config for the workspace shell.
 *
 * Hoisted to a single source of truth because FlexLayout serializes the
 * `global` block into the persisted model JSON. A layout saved with older
 * globals (e.g. `tabSetEnableDeleteWhenEmpty: false`) would otherwise keep
 * that stale behavior forever on restore. `readStoredModel` re-applies this
 * config over any restored layout so behavior flags always track current code
 * while the user's splits/tabs are preserved.
 */
const workspaceGlobalConfig = {
  enableEdgeDock: false,
  tabEnableClose: true,
  tabEnablePopout: false,
  tabEnablePopoutIcon: false,
  tabEnableRename: false,
  tabEnableRenderOnDemand: true,
  // A split tabset must auto-collapse once its last tab closes, otherwise it
  // lingers as an unclosable empty placeholder. FlexLayout only deletes an
  // empty tabset when BOTH enableDeleteWhenEmpty AND (tabset) enableClose are
  // true (see RowNode cleanup in flexlayout-react dist). When the root row
  // empties FlexLayout recreates a tabset, so the watermark still shows for a
  // genuinely empty workspace. The manual close button stays off.
  tabSetEnableClose: true,
  tabSetEnableCloseButton: false,
  tabSetEnableDeleteWhenEmpty: true,
  tabSetEnableMaximize: false,
  tabSetMinHeight: 180,
  tabSetMinWidth: 240,
  tabSetTabLocation: 'top',
} satisfies IJsonModel['global']

/** Builds the seed FlexLayout JSON for a new workspace dock. */
function baseModelJson(panel: WorkspacePanelInput): IJsonModel {
  return {
    global: workspaceGlobalConfig,
    borders: [],
    layout: {
      type: 'row',
      id: 'workspace-root',
      children: [
        {
          type: 'tabset',
          id: 'workspace-main',
          active: true,
          selected: 0,
          weight: 100,
          children: [panelToTabJson(panel)],
        },
      ],
    },
  }
}

/** Guards against restoring an empty FlexLayout model that would render dead chrome. */
function hasAnyTab(model: Model) {
  let found = false
  model.visitNodes((node) => {
    if (node instanceof TabNode) found = true
  })
  return found
}

/** Reads and validates Garden panel config from a FlexLayout tab node. */
export function getTabConfig(
  node: TabNode | null,
): WorkspacePanelConfig | null {
  const config = node?.getConfig()
  if (!config || typeof config !== 'object') return null
  const value = config as Partial<WorkspacePanelConfig>
  if (!isWorkspacePanelKind(value.kind) || typeof value.title !== 'string') {
    return null
  }
  const panel = {
    kind: value.kind,
    title: value.title,
    ...(typeof value.entityId === 'string' ? { entityId: value.entityId } : {}),
  }
  return {
    ...panel,
    canonicalId:
      typeof value.canonicalId === 'string'
        ? value.canonicalId
        : getCanonicalPanelId(panel),
    ...(value.pinned ? { pinned: true } : {}),
  }
}

/** Converts active/selected FlexLayout tab state back into public panel state. */
export function tabNodeToPanel(
  node: TabNode | null,
): WorkspacePanelInput | null {
  const config = getTabConfig(node)
  if (!config || !node) return null
  return {
    kind: config.kind,
    title: node.getName() || config.title,
    ...(config.entityId ? { entityId: config.entityId } : {}),
  }
}

/** Finds the tab FlexLayout considers active, with a fallback for restored models. */
export function findActiveTabNode(model: Model): TabNode | null {
  const active = model.getActiveTabset()?.getSelectedNode()
  if (active instanceof TabNode) return active

  let selected: TabNode | null = null
  let first: TabNode | null = null
  model.visitNodes((node) => {
    if (selected || !(node instanceof TabNode)) return
    first ??= node
    if (node.isSelected()) selected = node
  })
  return selected ?? first
}

/** Finds a tab by concrete FlexLayout node id or Garden canonical panel id. */
export function findTabByIdOrCanonical(
  model: Model,
  panelId: string,
): TabNode | null {
  const direct = model.getNodeById(panelId)
  if (direct instanceof TabNode) return direct

  let found: TabNode | null = null
  model.visitNodes((node) => {
    if (found || !(node instanceof TabNode)) return
    if (getTabConfig(node)?.canonicalId === panelId) found = node
  })
  return found
}

/** Finds the first tab matching a Garden canonical panel id. */
export function findTabByCanonical(
  model: Model,
  canonicalId: string,
): TabNode | null {
  let found: TabNode | null = null
  model.visitNodes((node) => {
    if (found || !(node instanceof TabNode)) return
    if (getTabConfig(node)?.canonicalId === canonicalId) found = node
  })
  return found
}

/** Finds the existing reusable tab bucket for a product panel. */
export function findTabByReuseKey(
  model: Model,
  panel: WorkspacePanelInput,
): TabNode | null {
  const reuseKey = getPanelReuseKey(panel)
  let found: TabNode | null = null
  model.visitNodes((node) => {
    if (found || !(node instanceof TabNode)) return
    const config = getTabConfig(node)
    if (config && getPanelReuseKey(config) === reuseKey) found = node
  })
  return found
}

/** Finds every concrete/duplicate tab represented by a node id or canonical id. */
export function findTabsByIdOrCanonical(model: Model, panelId: string) {
  const tabs: TabNode[] = []
  model.visitNodes((node) => {
    if (!(node instanceof TabNode)) return
    if (
      node.getId() === panelId ||
      getTabConfig(node)?.canonicalId === panelId
    ) {
      tabs.push(node)
    }
  })
  return tabs
}

/** Returns all tabsets so app actions can target active/first tabsets safely. */
export function getTabSetNodes(model: Model) {
  const tabsets: TabSetNode[] = []
  model.visitNodes((node) => {
    if (node instanceof TabSetNode) tabsets.push(node)
  })
  return tabsets
}

/** Returns all tabs in model traversal order for keyboard cycling. */
export function getTabNodes(model: Model) {
  const tabs: TabNode[] = []
  model.visitNodes((node) => {
    if (node instanceof TabNode) tabs.push(node)
  })
  return tabs
}

/** Returns the parent tabset for tab-level actions like maximize or split. */
export function getParentTabSet(node: TabNode | null) {
  const parent = node?.getParent()
  return parent instanceof TabSetNode ? parent : null
}

/** Returns a concrete target tab when callers want to replace an active blank tab. */
export function getTargetTab(
  model: Model,
  targetNodeId?: string,
): TabNode | null {
  if (!targetNodeId) return null
  const direct = model.getNodeById(targetNodeId)
  if (direct instanceof TabNode) return direct
  return findTabByIdOrCanonical(model, targetNodeId)
}

/** Resolves a caller-supplied node id into the tabset FlexLayout actions need. */
export function getTargetTabSet(
  model: Model,
  targetNodeId?: string,
): TabSetNode | null {
  if (targetNodeId) {
    const direct = model.getNodeById(targetNodeId)
    if (direct instanceof TabSetNode) return direct
    if (direct instanceof TabNode) return getParentTabSet(direct)
    const tab = findTabByIdOrCanonical(model, targetNodeId)
    const parent = getParentTabSet(tab)
    if (parent) return parent
  }

  return model.getActiveTabset() ?? getTabSetNodes(model)[0] ?? null
}

/** Namespaces persisted dock layouts by workspace id. */
export function getStorageKey(workspaceId: string) {
  return `garden:flexlayout:${workspaceId}`
}

/** Restores a persisted FlexLayout model, repairing stale globals before use. */
function readStoredModel(storageKey: string) {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(storageKey)
  if (!raw) return null

  return (
    Result.try(() => JSON.parse(raw) as IJsonModel)
      // Re-apply the current global behavior config so a layout persisted with
      // stale globals (e.g. the old `tabSetEnableDeleteWhenEmpty: false`, which
      // left emptied splits stuck as unclosable placeholders) adopts current
      // behavior on restore while keeping the user's splits and tabs.
      .map((json) => ({ ...json, global: workspaceGlobalConfig }))
      .andThen((json) => Result.try(() => Model.fromJson(json)))
      .tapError(() => window.localStorage.removeItem(storageKey))
      .match({
        ok: (model) => (hasAnyTab(model) ? model : null),
        err: () => null,
      })
  )
}

/** Persists FlexLayout's mutable model, ignoring unavailable/full storage. */
export function persistModel(storageKey: string, model: Model) {
  if (typeof window === 'undefined') return
  const result = Result.try(() =>
    window.localStorage.setItem(storageKey, JSON.stringify(model.toJson())),
  )
  if (Result.isError(result)) {
    // Storage can be disabled or full. FlexLayout remains usable in memory.
  }
}

/**
 * Build the initial FlexLayout model (restored from localStorage or seeded with
 * an Inbox tab).
 *
 * CLIENT-ONLY: FlexLayout's `Model.fromJson` builds `TabNode`s whose
 * constructor calls `document.createElement('div')`, so this cannot run on the
 * server. It is safe here only because the `/_authenticated/workspace` route is
 * declared `ssr: false`, so this component renders exclusively on the client.
 * If you ever see "document is not defined" from here, the route's SSR opt-out
 * was removed — restore it rather than guarding this function.
 */
export function createInitialModel(storageKey: string) {
  return (
    readStoredModel(storageKey) ??
    Model.fromJson(baseModelJson({ kind: 'inbox', title: 'Inbox' }))
  )
}

/** Updates both FlexLayout tab title attrs and the Garden config copy together. */
export function updateTabPanelConfig(
  model: Model,
  node: TabNode,
  panel: WorkspacePanelInput,
) {
  const pinned = getTabConfig(node)?.pinned === true
  model.doAction(
    Actions.updateNodeAttributes(node.getId(), {
      name: panel.title,
      component: panel.kind,
      enableClose: !pinned,
      config: toPanelConfig(panel, { pinned }),
    }),
  )
}
