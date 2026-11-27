import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SurfaceTabs } from '@garden/ui/components/shell/surface-tabs'
import {
  EMPTY_SURFACE_TABS,
  useSurfaceTabsStore,
  withActiveTab,
} from '@garden/app-state/surface-tabs'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { issueDetailOptions, issueListOptions } from '@/lib/issues/queries'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'

/**
 * Tasks surface tab strip: open task details as tabs (design: Tasks is one of
 * the two tabbable surfaces; its "+" returns to the tasks list where new tasks
 * are created). Tab state lives in the workspace-persisted surface-tabs store;
 * entries are added by useSurfaceNavigation on click-through and by the
 * tasks.$issueId route loader on direct loads. Display titles resolve live from
 * the shared issue-detail query cache so a tab opened by direct URL shows the
 * real title once data lands.
 */
export function TaskTabsStrip({ activeId }: { activeId: string | null }) {
  const storedTabs = useSurfaceTabsStore(
    (s) => s.bySurface['tasks'] ?? EMPTY_SURFACE_TABS,
  )
  const tabs = withActiveTab(storedTabs, activeId)
  const closeTab = useSurfaceTabsStore((s) => s.closeTab)
  const { openIssue, navigate } = useSurfaceNavigation()
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? '')

  // Resolve tab titles live: the issues list cache covers most tabs, and the
  // detail query (below) covers a tab opened by direct URL before the list
  // lands. Pure derivation at render — no effects.
  const issuesQuery = useQuery({
    ...issueListOptions(workspaceId),
    enabled: !!workspaceId,
  })
  const activeIssueQuery = useQuery({
    ...issueDetailOptions(workspaceId, activeId ?? ''),
    enabled: !!workspaceId && !!activeId,
  })
  const liveTitle = activeIssueQuery.data?.title
  const listTitles = new Map(
    (issuesQuery.data ?? []).map((issue) => [issue.id, issue.title]),
  )

  const displayTabs = tabs.map((tab) => {
    const live =
      (tab.id === activeId ? liveTitle : undefined) ?? listTitles.get(tab.id)
    return live ? { ...tab, title: live } : tab
  })

  const handleClose = useCallback(
    (id: string) => {
      closeTab('tasks', id)
      if (id === activeId) {
        const remaining = tabs.filter((tab) => tab.id !== id)
        const last = remaining[remaining.length - 1]
        if (last) openIssue(last)
        else void navigate({ to: '/tasks' })
      }
    },
    [activeId, closeTab, tabs, openIssue, navigate],
  )

  if (tabs.length === 0) return null

  return (
    <SurfaceTabs
      tabs={displayTabs}
      activeId={activeId}
      onSelect={(id) => {
        const tab = tabs.find((t) => t.id === id)
        if (tab) openIssue(tab)
      }}
      onClose={handleClose}
      onNew={() => void navigate({ to: '/tasks' })}
      newLabel="Tasks home"
    />
  )
}
