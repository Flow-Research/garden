import { Suspense, useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import type { IssueStatus } from '@garden/core/types'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { useSuspenseQueries } from '@tanstack/react-query'
import {
  useIssueViewStore,
  initFilterWorkspaceSync,
} from '@garden/app-state/issues/stores/view-store'
import { ViewStoreProvider } from '@garden/app-state/issues/stores/view-store-context'
import { filterIssues } from '../utils/filter'
import { BOARD_STATUSES } from '@garden/core/issues/config'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { WorkspaceAvatar } from '../../workspace/workspace-avatar'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  issueListOptions,
  childIssueProgressOptions,
} from '@/lib/issues/queries'
import { useUpdateIssue } from '@/lib/issues/mutations'
import { useIssueSelectionStore } from '@garden/app-state/issues/stores/selection-store'
import { PageHeader } from '../../layout/page-header'
import { IssuesHeader } from './issues-header'
import { BoardView } from './board-view'
import { ListView } from './list-view'
import { BatchActionToolbar } from './batch-action-toolbar'
import { useIssuesPageViewState } from '../hooks/use-issues-view-state'

function IssuesPageSkeleton({ viewMode }: { viewMode: 'board' | 'list' }) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="gap-1.5">
        <Skeleton className="h-6 w-6 rounded-md" />
        <Skeleton className="h-4 w-24" />
        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        <Skeleton className="h-4 w-12" />
      </PageHeader>

      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-14 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-9 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {viewMode === 'board' ? (
        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden p-4">
          {Array.from({ length: 5 }).map((_, columnIndex) => (
            <div
              key={columnIndex}
              className="flex min-w-[240px] flex-1 flex-col gap-2"
            >
              <div className="flex h-8 items-center justify-between px-1">
                <Skeleton className="h-5 w-24 rounded" />
                <Skeleton className="h-4 w-6 rounded" />
              </div>
              {Array.from({ length: columnIndex === 0 ? 3 : 2 }).map(
                (_, cardIndex) => (
                  <div
                    key={cardIndex}
                    className="rounded-lg border bg-card p-3 shadow-sm"
                  >
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="mt-2 h-3 w-full" />
                    <Skeleton className="mt-1.5 h-3 w-2/3" />
                    <div className="mt-4 flex items-center justify-between">
                      <Skeleton className="h-5 w-16 rounded" />
                      <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 space-y-2 overflow-hidden p-2">
          {Array.from({ length: 5 }).map((_, groupIndex) => (
            <div key={groupIndex} className="rounded-lg">
              <div className="flex h-10 items-center gap-3 rounded-lg bg-muted/40 px-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-5 w-28 rounded" />
                <Skeleton className="h-4 w-6 rounded" />
              </div>
              {Array.from({ length: groupIndex === 0 ? 3 : 2 }).map(
                (_, rowIndex) => (
                  <div
                    key={rowIndex}
                    className="mt-1 flex h-12 items-center gap-3 rounded-md border bg-card px-3"
                  >
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-5 w-16 rounded" />
                    <Skeleton className="h-6 w-6 rounded-full" />
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function IssuesPage() {
  const { viewMode } = useIssuesPageViewState()

  return (
    <Suspense fallback={<IssuesPageSkeleton viewMode={viewMode} />}>
      <IssuesPageContent />
    </Suspense>
  )
}

function IssuesPageContent() {
  const wsId = useWorkspaceId()
  const [{ data: allIssues }, { data: childProgressMap }] =
    useSuspenseQueries({
      queries: [issueListOptions(wsId), childIssueProgressOptions(wsId)],
    })

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
