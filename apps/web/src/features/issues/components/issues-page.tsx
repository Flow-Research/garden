'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { toast } from 'sonner'
import { ChevronRight, ListTodo } from 'lucide-react'
import type { IssueStatus } from '@garden/core/types'
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

const ISSUES_PAGE_SKELETON = 'issues-page'

function IssuesPageSkeletonFixture() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="size-5 rounded bg-muted-foreground/25" />
        <span className="text-sm text-muted-foreground">Acme</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm font-medium">Issues</span>
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          {['All', 'Members', 'Agents'].map((scope) => (
            <div
              key={scope}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-muted-foreground"
            >
              {scope}
            </div>
          ))}
        </div>
        <div className="rounded-md bg-accent px-3 py-1.5 text-xs text-muted-foreground">
          Board
        </div>
      </div>
      <div className="flex flex-1 min-h-0 gap-4 overflow-x-auto p-4">
        {['Backlog', 'Todo', 'In Progress', 'Done'].map((status) => (
          <div
            key={status}
            className="flex min-w-52 flex-1 flex-col gap-2 rounded-lg border border-border/70 bg-card p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {status}
              </span>
              <span className="text-xs text-muted-foreground">3</span>
            </div>
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={`${status}-${index}`}
                className="space-y-2 rounded-md border border-border/70 bg-background px-3 py-3"
              >
                <div className="h-2 w-10 rounded-full bg-emerald-500/70" />
                <p className="text-sm font-medium text-foreground">
                  {status} issue {index + 1}
                </p>
                <p className="text-xs text-muted-foreground">
                  Ready for the next step
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function IssuesPageSkeleton() {
  const fixture = <IssuesPageSkeletonFixture />

  return (
    <BoneyardSkeleton
      name={ISSUES_PAGE_SKELETON}
      loading
      fixture={fixture}
      className="flex flex-1 min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

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

  return (
    <BoneyardSkeleton
      name={ISSUES_PAGE_SKELETON}
      loading={loading}
      className="flex flex-1 min-h-0"
    >
      {!loading ? (
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

        {/* Content: scrollable */}
        {scopedIssues.length === 0 ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 text-muted-foreground">
            <ListTodo className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm">No issues yet</p>
            <p className="text-xs">Create an issue to get started.</p>
          </div>
        ) : (
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
        )}
        {viewMode === 'list' && <BatchActionToolbar />}
      </ViewStoreProvider>
        </div>
      ) : null}
    </BoneyardSkeleton>
  )
}
