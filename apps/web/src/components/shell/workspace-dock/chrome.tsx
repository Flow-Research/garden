import {
  Columns2,
  Maximize2,
  Minimize2,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
} from 'lucide-react'
import { TabNode, TabSetNode, type BorderNode } from 'flexlayout-react'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { Button } from '@garden/ui/components/ui/button'
import { useSidebar } from '@garden/ui/components/ui/sidebar'
import { cn } from '@garden/ui/lib/utils'
import { useRequiredWorkspaceDock, useWorkspaceDock } from './context'
import { tabNodeToPanel } from './model'
import { panelUsesContextRail } from './types'

/** Renders FlexLayout's empty-tabset placeholder as a branded Garden workspace state. */
export function WorkspaceDockWatermark() {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const dock = useWorkspaceDock()

  return (
    <div className="garden-dock-watermark">
      <div className="garden-dock-watermark__copy">
        <span className="garden-dock-watermark__eyebrow">Workspace</span>
        <h2>{workspace?.name ?? 'Garden'}</h2>
        <p>Open a tab from the rail or use the new-tab button above.</p>
      </div>
      {dock ? (
        <div className="garden-dock-watermark__actions">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={dock.openNewTab}
          >
            <Plus className="size-3.5" />
            New tab
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Adds Garden-specific controls to every FlexLayout tabset header. */
export function WorkspaceTabSetToolbar({
  node,
}: {
  node: TabSetNode | BorderNode
}) {
  const dock = useRequiredWorkspaceDock()
  const sidebar = useSidebar()
  const selected = node.getSelectedNode()
  const selectedTab = selected instanceof TabNode ? selected : null
  const selectedPanel = tabNodeToPanel(selectedTab)
  const panelId = selectedTab?.getId() ?? null
  const canUseContextRail = panelUsesContextRail(selectedPanel?.kind)
  const railOpen = sidebar.state === 'expanded'
  const expanded = panelId ? dock.isPanelExpanded(panelId) : false
  const pinned = panelId ? dock.isPanelPinned(panelId) : false

  return (
    <div
      className="garden-dock-actions"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={cn(
          'garden-dock-actions__button garden-dock-actions__button--context-rail',
          railOpen && 'garden-dock-actions__button--active',
        )}
        disabled={!canUseContextRail}
        onClick={sidebar.toggleSidebar}
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
        disabled={!panelId}
        onClick={() => panelId && dock.splitPanel(panelId)}
        title="Split right"
      >
        <Columns2 className="size-3.5" />
      </button>
      <button
        type="button"
        className="garden-dock-actions__button"
        disabled={!panelId}
        onClick={() => panelId && dock.togglePanelExpanded(panelId)}
        title={expanded ? 'Restore split' : 'Expand tab'}
      >
        {expanded ? (
          <Minimize2 className="size-3.5" />
        ) : (
          <Maximize2 className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        className={cn(
          'garden-dock-actions__button',
          pinned && 'garden-dock-actions__button--active',
        )}
        disabled={!panelId}
        onClick={() => panelId && dock.togglePanelPinned(panelId)}
        title={pinned ? 'Unpin tab' : 'Pin tab'}
      >
        {pinned ? (
          <PinOff className="size-3.5" />
        ) : (
          <Pin className="size-3.5" />
        )}
      </button>
    </div>
  )
}

/** Keeps New Tab beside the tab strip instead of grouped with left-side actions. */
export function WorkspaceNewTabButton({
  node,
}: {
  node: TabSetNode | BorderNode
}) {
  const dock = useRequiredWorkspaceDock()
  const tabsetId = node instanceof TabSetNode ? node.getId() : null

  return (
    <button
      type="button"
      className="garden-dock-tab-add"
      disabled={!tabsetId}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() =>
        tabsetId &&
        dock.openPanel(
          { kind: 'blank', title: 'New Tab' },
          { forceNew: true, targetPanelId: tabsetId },
        )
      }
      title="New tab"
      aria-label="New tab"
    >
      <Plus className="size-3.5" />
    </button>
  )
}
