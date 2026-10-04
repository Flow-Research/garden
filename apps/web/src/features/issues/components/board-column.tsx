import { useMemo, type ReactNode } from 'react'
import { EyeOff, Plus } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Issue, IssueStatus } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { useViewStoreApi } from '@garden/app-state/issues/stores/view-store-context'
import { StatusIcon } from './status-icon'
import { DraggableBoardCard } from './board-card'
import type { ChildProgress } from './list-row'

/** Design's pastel status pill fills (Global util colors — constant in both themes). */
const STATUS_PILL_FILL: Record<IssueStatus, string> = {
  todo: 'var(--util-color-9)',
  in_progress: 'var(--util-color-2)',
  in_review: 'var(--util-color-7)',
  done: 'var(--util-color-8)',
  blocked: 'var(--util-color-10)',
  cancelled: 'var(--util-color-5)',
}

export function BoardColumn({
  status,
  issueIds,
  issueMap,
  childProgressMap,
  totalCount,
  footer,
  onCreateIssue,
  projectTitleById,
}: {
  status: IssueStatus
  issueIds: string[]
  issueMap: Map<string, Issue>
  childProgressMap?: Map<string, ChildProgress>
  totalCount?: number
  footer?: ReactNode
  /** When omitted, the add-issue button is hidden. */
  onCreateIssue?: (data?: Record<string, unknown> | null) => void
  /** Project title lookup for the card's project chip. */
  projectTitleById?: Map<string, string>
}) {
  const cfg = STATUS_CONFIG[status]
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const viewStoreApi = useViewStoreApi()

  // Resolve IDs to Issue objects, preserving parent-provided order
  const resolvedIssues = useMemo(
    () =>
      issueIds.flatMap((id) => {
        const issue = issueMap.get(id)
        return issue ? [issue] : []
      }),
    [issueIds, issueMap],
  )

  return (
    <div className="flex w-[381px] shrink-0 flex-col rounded-lg border-[0.5px] border-border-default bg-background-main-secondary p-4">
      <div className="flex items-center justify-between">
        {/* Left: pastel status pill + plain count (design) */}
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs text-gray-900"
            style={{ backgroundColor: STATUS_PILL_FILL[status] }}
          >
            <StatusIcon status={status} className="size-3.5" inheritColor />
            {cfg.label}
          </span>
          <span className="text-xs text-text-secondary">
            {totalCount ?? issueIds.length}
          </span>
        </div>

        {/* Right: hide + add (design shows the eye icon directly) */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`Hide ${cfg.label} column`}
                  className="text-icon-secondary"
                  onClick={() => viewStoreApi.getState().hideStatus(status)}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <EyeOff className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Hide column</TooltipContent>
          </Tooltip>
          {onCreateIssue ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-icon-secondary"
                    onClick={() => onCreateIssue({ status })}
                  />
                }
              >
                <Plus className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Add issue</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`mt-6 flex min-h-[200px] flex-1 flex-col gap-6 overflow-y-auto rounded-md transition-colors ${
          isOver ? 'bg-accent/60' : ''
        }`}
      >
        <SortableContext
          items={issueIds}
          strategy={verticalListSortingStrategy}
        >
          {resolvedIssues.map((issue) => (
            <DraggableBoardCard
              key={issue.id}
              issue={issue}
              childProgress={childProgressMap?.get(issue.id)}
              projectTitle={
                issue.project_id
                  ? projectTitleById?.get(issue.project_id)
                  : undefined
              }
            />
          ))}
        </SortableContext>
        {issueIds.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No issues
          </p>
        )}
        {footer}
      </div>
    </div>
  )
}
