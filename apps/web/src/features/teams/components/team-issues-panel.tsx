import { useCallback, useDeferredValue, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type { Issue, IssueStatus } from '@garden/core/types'
import { BOARD_STATUSES } from '@garden/core/issues/config'
import { useViewStore } from '@garden/app-state/issues/stores/view-store-context'
import { toast } from 'sonner'
import { BoardView } from '@/features/issues/components/board-view'
import { ListView } from '@/features/issues/components/list-view'
import { filterIssues, matchesIssueSearch } from '@/features/issues/utils/filter'
import { useUpdateIssue } from '@/lib/issues/mutations'
import { projectListOptions } from '@/lib/projects/queries'
import { teamIssueViewStore } from '../view-store'
import { hashColor } from './team-tokens'

const STATUSES = BOARD_STATUSES

/**
 * Shared Team issue surface: the existing workspace list/board views over a
 * Team-filtered issue set. The toolbar owns search, filter, and the list/board
 * toggle (matching the design's single control row); this panel applies the
 * shared `teamIssueViewStore` filters plus the search query and renders the
 * store's current viewMode — the old per-tab `initialView` forcing is gone
 * because there is a single Issues view the user flips in place.
 */
export function TeamIssuesPanel({
  issues,
  searchQuery,
  teamChips,
  onCreateIssue,
}: {
  issues: Issue[]
  searchQuery: string
  teamChips?: Map<string, { name: string; color: string }>
  onCreateIssue: (data?: Record<string, unknown> | null) => void
}) {
  const wsId = useWorkspaceId()
  const deferredSearch = useDeferredValue(searchQuery.trim())
  const { data: projectList = [] } = useQuery(projectListOptions(wsId))
  const projects = useMemo(
    () =>
      new Map(
        projectList.map(
          (project) =>
            [
              project.id,
              { title: project.title, color: hashColor(project.id) },
            ] as const,
        ),
      ),
    [projectList],
  )
  const viewMode = useViewStore((s) => s.viewMode)
  const statusFilters = useViewStore((s) => s.statusFilters)
  const priorityFilters = useViewStore((s) => s.priorityFilters)
  const assigneeFilters = useViewStore((s) => s.assigneeFilters)
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee)
  const creatorFilters = useViewStore((s) => s.creatorFilters)
  const projectFilters = useViewStore((s) => s.projectFilters)
  const includeNoProject = useViewStore((s) => s.includeNoProject)
  const updateIssueMutation = useUpdateIssue()

  const filteredIssues = useMemo(() => {
    const visible = filterIssues(issues, {
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
    })
    return deferredSearch
      ? visible.filter((issue) => matchesIssueSearch(issue, deferredSearch))
      : visible
  }, [
    issues,
    deferredSearch,
    statusFilters,
    priorityFilters,
    assigneeFilters,
    includeNoAssignee,
    creatorFilters,
    projectFilters,
    includeNoProject,
  ])

  const doneTotal = useMemo(
    () => filteredIssues.filter((issue) => issue.status === 'done').length,
    [filteredIssues],
  )

  const visibleStatuses = useMemo(
    () =>
      statusFilters.length > 0
        ? STATUSES.filter((status) => statusFilters.includes(status))
        : STATUSES,
    [statusFilters],
  )

  const hiddenStatuses = useMemo(
    () => STATUSES.filter((status) => !visibleStatuses.includes(status)),
    [visibleStatuses],
  )

  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus, newPosition?: number) => {
      const viewState = teamIssueViewStore.getState()
      if (viewState.sortBy !== 'position') {
        viewState.setSortBy('position')
        viewState.setSortDirection('asc')
      }
      updateIssueMutation.mutate(
        {
          id: issueId,
          status: newStatus,
          ...(newPosition !== undefined ? { position: newPosition } : {}),
        },
        { onError: () => toast.error('Failed to move issue') },
      )
    },
    [updateIssueMutation],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {viewMode === 'board' ? (
        <BoardView
          allIssues={filteredIssues}
          doneTotal={doneTotal}
          hiddenStatuses={hiddenStatuses}
          issues={filteredIssues}
          onCreateIssue={onCreateIssue}
          onMoveIssue={handleMoveIssue}
          visibleStatuses={visibleStatuses}
        />
      ) : (
        <ListView
          doneTotal={doneTotal}
          issues={filteredIssues}
          onCreateIssue={onCreateIssue}
          projects={projects}
          teamChips={teamChips}
          variant="team"
          visibleStatuses={visibleStatuses}
        />
      )}
    </div>
  )
}
