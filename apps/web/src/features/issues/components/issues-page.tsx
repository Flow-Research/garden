'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import type { IssueStatus } from '@garden/core/types'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { useQuery } from '@tanstack/react-query'
import {
  useIssueViewStore,
  initFilterWorkspaceSync,
} from '@garden/core/issues/stores/view-store'
import { ViewStoreProvider } from '@garden/core/issues/stores/view-store-context'
import { filterIssues } from '../utils/filter'
import { BOARD_STATUSES } from '@garden/core/issues/config'
import { useWorkspaceStore } from '@garden/core/workspace'
import { WorkspaceAvatar } from '../../workspace/workspace-avatar'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  issueListOptions,
  childIssueProgressOptions,
} from '@garden/core/issues/queries'
import { useUpdateIssue } from '@garden/core/issues/mutations'
import { useIssueSelectionStore } from '@garden/core/issues/stores/selection-store'
import { PageHeader } from '../../layout/page-header'
import { IssuesHeader } from './issues-header'
import { BoardView } from './board-view'
import { ListView } from './list-view'
import { BatchActionToolbar } from './batch-action-toolbar'
import { useIssuesPageViewState } from '../hooks/use-issues-view-state'

export function IssuesPage() {
  const wsId = useWorkspaceId()
  const { data: allIssues = [], isLoading: loading } = useQuery(
    issueListOptions(wsId),
  )

  const workspace = useWorkspaceStore((s) => s.workspace)
  const {
    scope,
    viewMode,
    statusFilters,
    priorityFilters,
    assigneeFilters,
    includeNoAssignee,
    creatorFilters,
    projectFilters,
    includeNoProject,
  } = useIssuesPageViewState()

  useEffect(() => {
    initFilterWorkspaceSync((cb) =>
      useWorkspaceStore.subscribe((s) => cb(s.workspace?.id)),
    )
  }, [])

  useEffect(() => {
    useIssueSelectionStore.getState().clear()
  }, [viewMode, scope])

  // Scope pre-filter: narrow by assignee type
  const scopedIssues = useMemo(() => {
    if (scope === 'members')
      return allIssues.filter((i) => i.assignee_type === 'member')
    if (scope === 'agents')
      return allIssues.filter((i) => i.assignee_type === 'agent')
    return allIssues
  }, [allIssues, scope])

  const issues = useMemo(
    () =>
      filterIssues(scopedIssues, {
        statusFilters,
        priorityFilters,
        assigneeFilters,
        includeNoAssignee,
        creatorFilters,
        projectFilters,
        includeNoProject,
      }),
    [
      scopedIssues,
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
    ],
  )

  // Fetch sub-issue progress from the backend so counts are accurate
  // regardless of client-side pagination or filtering of done issues.
  const { data: childProgressMap = new Map() } = useQuery(
    childIssueProgressOptions(wsId),
  )

  const visibleStatuses = useMemo(() => {
    if (statusFilters.length > 0)
      return BOARD_STATUSES.filter((s) => statusFilters.includes(s))
    return BOARD_STATUSES
  }, [statusFilters])

  const hiddenStatuses = useMemo(() => {
    return BOARD_STATUSES.filter((s) => !visibleStatuses.includes(s))
  }, [visibleStatuses])

  const updateIssueMutation = useUpdateIssue()
  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus, newPosition?: number) => {
      // Auto-switch to manual sort so drag ordering is preserved
      const viewState = useIssueViewStore.getState()
      if (viewState.sortBy !== 'position') {
        viewState.setSortBy('position')
        viewState.setSortDirection('asc')
      }

      const updates: Partial<{ status: IssueStatus; position: number }> = {
        status: newStatus,
      }
      if (newPosition !== undefined) updates.position = newPosition

      updateIssueMutation.mutate(
        { id: issueId, ...updates },
        { onError: () => toast.error('Failed to move issue') },
      )
    },
    [updateIssueMutation],
  )

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex flex-1 min-h-0 gap-4 overflow-x-auto p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex min-w-52 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Header 1: Workspace breadcrumb */}
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? 'W'} size="sm" />
        <span className="text-sm text-muted-foreground">
          {workspace?.name ?? 'Workspace'}
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm font-medium">Issues</span>
      </PageHeader>

      <ViewStoreProvider store={useIssueViewStore}>
        {/* Header 2: Scope tabs + filters */}
        <IssuesHeader scopedIssues={scopedIssues} />

        {/* Content — kanban/list always renders; per-column "No issues"
            placeholders carry the empty state so the board still shows. */}
        <div className="flex flex-col flex-1 min-h-0">
          {viewMode === 'board' ? (
            <BoardView
              issues={issues}
              allIssues={scopedIssues}
              visibleStatuses={visibleStatuses}
              hiddenStatuses={hiddenStatuses}
              onMoveIssue={handleMoveIssue}
              childProgressMap={childProgressMap}
            />
          ) : (
            <ListView
              issues={issues}
              visibleStatuses={visibleStatuses}
              childProgressMap={childProgressMap}
            />
          )}
        </div>
        {viewMode === 'list' && <BatchActionToolbar />}
      </ViewStoreProvider>
    </div>
  )
}
