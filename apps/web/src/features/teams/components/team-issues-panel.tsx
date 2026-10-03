import { useCallback, useDeferredValue, useMemo, useState } from 'react'
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
 * Team-filtered issue set. The Team detail tab toolbar owns search and filter
 * state (matching the design's single control row); this panel applies the
 * shared `teamIssueViewStore` filters plus the search query. The Teams Issues
 * tab renders the design list (no selection, team/project/description chips);
 * the Tasks tab renders the board.
 */
export function TeamIssuesPanel({
  issues,
  initialView,
  searchQuery,
  teamChips,
  onCreateIssue,
}: {
  issues: Issue[]
  initialView: 'list' | 'board'
  searchQuery: string
  teamChips?: Map<string, { name: string; color: string }>
  onCreateIssue: (data?: Record<string, unknown> | null) => void
}) {
  const wsId = useWorkspaceId()
  const [viewReady, setViewReady] = useState(false)
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
  const statusFilters = useViewStore((s) => s.statusFilters)
  const priorityFilters = useViewStore((s) => s.priorityFilters)
  const assigneeFilters = useViewStore((s) => s.assigneeFilters)
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee)
  const creatorFilters = useViewStore((s) => s.creatorFilters)
  const projectFilters = useViewStore((s) => s.projectFilters)
  const includeNoProject = useViewStore((s) => s.includeNoProject)
  const updateIssueMutation = useUpdateIssue()

  // The tab owns the view mode; force it on first render like the pre-refactor
  // panel did so a persisted board/list preference cannot leak across tabs.
  if (!viewReady) {
    teamIssueViewStore.setState({ viewMode: initialView })
    setViewReady(true)
  }

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
      {initialView === 'board' ? (
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
