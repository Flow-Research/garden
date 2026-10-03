import { useCallback, useMemo } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { Accordion } from '@base-ui/react/accordion'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import type { Issue, IssueStatus } from '@garden/core/types'
import { useLoadMoreDoneIssues } from '@/lib/issues/mutations'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { useViewStore } from '@garden/app-state/issues/stores/view-store-context'
import { useIssueSelectionStore } from '@garden/app-state/issues/stores/selection-store'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import { sortIssues } from '../utils/sort'
import { StatusIcon } from './status-icon'
import { ListRow, type ChildProgress } from './list-row'
import { InfiniteScrollSentinel } from './infinite-scroll-sentinel'

const EMPTY_PROGRESS_MAP = new Map<string, ChildProgress>()

export function ListView({
  issues,
  visibleStatuses,
  childProgressMap = EMPTY_PROGRESS_MAP,
  teamChips,
  projects,
  variant = 'default',
  doneTotal: doneTotalOverride,
  onCreateIssue,
}: {
  issues: Issue[]
  visibleStatuses: IssueStatus[]
  childProgressMap?: Map<string, ChildProgress>
  /** Team chip per issue for cross-team views (Teams › Issues). */
  teamChips?: Map<string, { name: string; color: string }>
  /** Project chip per project id for the Team list variant. */
  projects?: Map<string, { title: string; color: string }>
  /**
   * `team` renders the design's Team detail Issues list: no selection
   * checkboxes, pill group headers with plain label + count, and rows with
   * status icon + title + team/project/description chips. Default keeps the
   * workspace list with batch selection.
   */
  variant?: 'default' | 'team'
  /** Override the done-group count (e.g. with a server-filtered total). */
  doneTotal?: number
  /** When omitted, create affordances are hidden (read-only cross-team views). */
  onCreateIssue?: (data?: Record<string, unknown> | null) => void
}) {
  const { openIssue } = useSurfaceNavigation()
  const handleOpenIssue = useCallback(
    (issue: Issue) => {
      openIssue({ id: issue.id, title: issue.title })
    },
    [openIssue],
  )
  const sortBy = useViewStore((s) => s.sortBy)
  const sortDirection = useViewStore((s) => s.sortDirection)
  const listCollapsedStatuses = useViewStore((s) => s.listCollapsedStatuses)
  const toggleListCollapsed = useViewStore((s) => s.toggleListCollapsed)
  const selectedIds = useIssueSelectionStore((s) => s.selectedIds)
  const select = useIssueSelectionStore((s) => s.select)
  const deselect = useIssueSelectionStore((s) => s.deselect)
  const {
    loadMore,
    hasMore,
    isLoading: loadingMore,
    doneTotal: hookDoneTotal,
  } = useLoadMoreDoneIssues()
  const displayDoneTotal = doneTotalOverride ?? hookDoneTotal
  const canLoadMoreDone = doneTotalOverride === undefined && hasMore

  const isTeam = variant === 'team'

  const issuesByStatus = useMemo(() => {
    const map = new Map<IssueStatus, Issue[]>()
    for (const status of visibleStatuses) {
      const filtered = issues.filter((i) => i.status === status)
      map.set(status, sortIssues(filtered, sortBy, sortDirection))
    }
    return map
  }, [issues, visibleStatuses, sortBy, sortDirection])

  const expandedStatuses = useMemo(
    () => visibleStatuses.filter((s) => !listCollapsedStatuses.includes(s)),
    [visibleStatuses, listCollapsedStatuses],
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-2">
      <Accordion.Root
        multiple
        className={cn('space-y-1', isTeam && 'space-y-2')}
        value={expandedStatuses}
        onValueChange={(value: string[]) => {
          for (const status of visibleStatuses) {
            const wasExpanded = expandedStatuses.includes(status)
            const isExpanded = value.includes(status)
            if (wasExpanded !== isExpanded) {
              toggleListCollapsed(status as IssueStatus)
            }
          }
        }}
      >
        {visibleStatuses.map((status) => {
          const cfg = STATUS_CONFIG[status]
          const statusIssues = issuesByStatus.get(status) ?? []
          const statusIssueIds = statusIssues.map((i) => i.id)
          const selectedCount = statusIssueIds.filter((id) =>
            selectedIds.has(id),
          ).length
          const allSelected =
            statusIssues.length > 0 && selectedCount === statusIssues.length
          const someSelected = selectedCount > 0
          const statusCount =
            status === 'done' ? displayDoneTotal : statusIssues.length
          const expanded = expandedStatuses.includes(status)

          const rows =
            statusIssues.length > 0 ? (
              <>
                {statusIssues.map((issue) => (
                  <ListRow
                    key={issue.id}
                    issue={issue}
                    childProgress={childProgressMap.get(issue.id)}
                    team={teamChips?.get(issue.id)}
                    project={projects?.get(issue.project_id ?? '')}
                    variant={variant}
                    onOpen={handleOpenIssue}
                  />
                ))}
                {status === 'done' && canLoadMoreDone && (
                  <InfiniteScrollSentinel
                    onVisible={loadMore}
                    loading={loadingMore}
                  />
                )}
              </>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No issues
              </p>
            )

          return (
            <Accordion.Item key={status} value={status}>
              {isTeam ? (
                // Open groups merge the header into the body: top corners on
                // the header, bottom corners on the body. Collapsed groups
                // keep the fully-rounded pill.
                <Accordion.Header
                  className={cn(
                    'flex h-[54px] items-center bg-background-main-secondary',
                    expanded ? 'rounded-t-xl' : 'rounded-xl',
                  )}
                >
                  <Accordion.Trigger className="group/trigger flex h-full flex-1 items-center gap-2 px-4 text-left outline-none">
                    <ChevronRight className="size-3.5 shrink-0 text-icon-secondary transition-transform group-aria-expanded/trigger:rotate-90" />
                    <StatusIcon status={status} className="size-4.5" />
                    <span className="text-sm text-text-default">
                      {cfg.label}
                    </span>
                    <span className="text-sm text-text-default">
                      {statusCount}
                    </span>
                  </Accordion.Trigger>
                  <div className="pr-3">
                    {onCreateIssue ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-icon-default"
                              onClick={() => onCreateIssue({ status })}
                            />
                          }
                        >
                          <Plus className="size-4.5" />
                        </TooltipTrigger>
                        <TooltipContent>Add issue</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </Accordion.Header>
              ) : (
                <Accordion.Header className="group/header flex h-10 items-center rounded-lg bg-muted/40 transition-colors hover:bg-accent/30">
                  <div className="pl-3 flex items-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected && !allSelected
                      }}
                      onChange={() => {
                        if (allSelected) {
                          deselect(statusIssueIds)
                        } else {
                          select(statusIssueIds)
                        }
                      }}
                      className="cursor-pointer accent-primary"
                    />
                  </div>
                  <Accordion.Trigger className="group/trigger flex flex-1 items-center gap-2 px-2 h-full text-left outline-none">
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/trigger:rotate-90" />
                    <span
                      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ${cfg.badgeBg} ${cfg.badgeText}`}
                    >
                      <StatusIcon
                        status={status}
                        className="h-3 w-3"
                        inheritColor
                      />
                      {cfg.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {statusCount}
                    </span>
                  </Accordion.Trigger>
                  <div className="pr-2">
                    {onCreateIssue ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-full text-muted-foreground opacity-0 group-hover/header:opacity-100 transition-opacity"
                              onClick={() => onCreateIssue({ status })}
                            />
                          }
                        >
                          <Plus className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Add issue</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </Accordion.Header>
              )}

              {isTeam ? (
                <Accordion.Panel>
                  <div className="-mt-1 rounded-b-xl border-[0.5px] border-border-default bg-background-main-default">
                    {rows}
                  </div>
                </Accordion.Panel>
              ) : (
                <Accordion.Panel className="pt-1">{rows}</Accordion.Panel>
              )}
            </Accordion.Item>
          )
        })}
      </Accordion.Root>
    </div>
  )
}
