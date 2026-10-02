import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import type { Issue, IssueStatus } from '@garden/core/types'
import { BOARD_STATUSES } from '@garden/core/issues/config'
import { ViewStoreProvider } from '@garden/app-state/issues/stores/view-store-context'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { BoardView } from '@/features/issues/components/board-view'
import { ListView } from '@/features/issues/components/list-view'
import { matchesIssueSearch } from '@/features/issues/utils/filter'
import { useUpdateIssue } from '@/lib/issues/mutations'
import { teamIssueViewStore } from '../view-store'

const STATUSES = BOARD_STATUSES

/**
 * Shared Team issue surface: search, board/list toggle, and the existing
 * workspace issue views over a Team-filtered issue set. The Teams Issues tab
 * defaults to the list view; the Tasks tab defaults to the board.
 */
export function TeamIssuesPanel({
  issues,
  initialView,
  onCreateIssue,
}: {
  issues: Issue[]
  initialView: 'list' | 'board'
  onCreateIssue: (data?: Record<string, unknown> | null) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearch = useDeferredValue(searchQuery.trim())
  const [viewMode, setViewMode] = useState<'list' | 'board'>(() => {
    teamIssueViewStore.setState({ viewMode: initialView })
    return initialView
  })
  const updateIssueMutation = useUpdateIssue()

  const filteredIssues = useMemo(
    () =>
      deferredSearch
        ? issues.filter((issue) => matchesIssueSearch(issue, deferredSearch))
        : issues,
    [issues, deferredSearch],
  )

  const doneTotal = useMemo(
    () => filteredIssues.filter((issue) => issue.status === 'done').length,
    [filteredIssues],
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
    <ViewStoreProvider store={teamIssueViewStore}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-icon-secondary" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search issues..."
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border p-0.5">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => {
                setViewMode('list')
                teamIssueViewStore.setState({ viewMode: 'list' })
              }}
              aria-label="List view"
            >
              <List className="size-4" />
            </Button>
            <Button
              variant={viewMode === 'board' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => {
                setViewMode('board')
                teamIssueViewStore.setState({ viewMode: 'board' })
              }}
              aria-label="Board view"
            >
              <LayoutGrid className="size-4" />
            </Button>
          </div>
          <Button onClick={() => onCreateIssue(null)}>
            <Plus className="size-4" />
            New Issue
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {viewMode === 'board' ? (
          <BoardView
            issues={filteredIssues}
            allIssues={filteredIssues}
            visibleStatuses={STATUSES}
            hiddenStatuses={[]}
            onMoveIssue={handleMoveIssue}
            doneTotal={doneTotal}
            onCreateIssue={onCreateIssue}
          />
        ) : (
          <ListView
            issues={filteredIssues}
            visibleStatuses={STATUSES}
            doneTotal={doneTotal}
            onCreateIssue={onCreateIssue}
          />
        )}
      </div>
    </ViewStoreProvider>
  )
}
