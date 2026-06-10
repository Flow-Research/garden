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

export type WorkspacePanelConfig = WorkspacePanelInput & {
  canonicalId: string
  pinned?: boolean
}

export type OpenPanelOptions = {
  forceNew?: boolean
  targetPanelId?: string
  splitRight?: boolean
  index?: number
}

export type BlankPanelChoice = WorkspacePanelInput & {
  description: string
  forceNew?: boolean
}

export type WorkspaceDockContextValue = {
  activePanel: WorkspacePanelInput | null
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
  updateChatPanelSession: (
    panelId: string,
    session: { id: string; title: string },
  ) => void
}

export const workspacePanelKinds = [
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

export const singletonKinds = new Set<WorkspacePanelKind>([
  'dashboard',
  'inbox',
  'issues',
  'automations',
  'skill-editor',
  'capabilities',
  'agents',
])

/** Maps dock panel kinds to the rail context that should highlight/open for them. */
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

/** Returns whether a rail has an inner context rail instead of only a top-level section. */
export function railUsesContextRail(rail: WorkspaceRailContext): boolean {
  return (
    rail === 'chats' ||
    rail === 'skills' ||
    rail === 'agents' ||
    rail === 'connections'
  )
}

/** Returns whether a panel kind can use the inner context rail toolbar toggle. */
export function panelUsesContextRail(
  kind: WorkspacePanelKind | null | undefined,
) {
  return railUsesContextRail(getRailContextForPanel(kind))
}

/** Narrows persisted FlexLayout config back into Garden panel kinds. */
export function isWorkspacePanelKind(
  value: unknown,
): value is WorkspacePanelKind {
  return (
    typeof value === 'string' &&
    workspacePanelKinds.includes(value as WorkspacePanelKind)
  )
}
