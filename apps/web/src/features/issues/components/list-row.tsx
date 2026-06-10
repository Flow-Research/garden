import { memo, useCallback } from 'react'
import type { Issue } from '@garden/core/types'
import { Badge } from '@garden/ui/components/ui/badge'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import { ActorAvatar } from '../../common/actor-avatar'
import { useIssueSelectionStore } from '@garden/app-state/issues/stores/selection-store'
import { PriorityIcon } from './priority-icon'
import { ProgressRing } from './progress-ring'

export interface ChildProgress {
  done: number
  total: number
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export const ListRow = memo(function ListRow({
  issue,
  childProgress,
  onOpen,
}: {
  issue: Issue
  childProgress?: ChildProgress
  /** Click handler for the row. Caller wires this to a navigation source
   * (workspace dock, router push, etc.). When omitted, the row acts as a
   * no-op anchor — useful for previews / dev showcases. */
  onOpen?: (issue: Issue) => void
}) {
  const selected = useIssueSelectionStore((s) => s.selectedIds.has(issue.id))
  const toggle = useIssueSelectionStore((s) => s.toggle)
  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      if (!onOpen) return
      e.preventDefault()
      onOpen(issue)
    },
    [onOpen, issue],
  )

  return (
    <div
      className={`group/row flex h-9 items-center gap-2 px-4 text-sm transition-colors hover:bg-accent/50 ${
        selected ? 'bg-accent/30' : ''
      }`}
    >
      <div className="relative flex shrink-0 items-center justify-center w-4 h-4">
        <PriorityIcon
          priority={issue.priority}
          className={selected ? 'hidden' : 'group-hover/row:hidden'}
        />
        <Checkbox
          checked={selected}
          onCheckedChange={() => toggle(issue.id)}
          className={`absolute inset-0 size-4 ${selected ? '' : 'hidden group-hover/row:flex'}`}
          aria-label={selected ? 'Deselect issue' : 'Select issue'}
        />
      </div>
      <a
        href={`/issues/${issue.id}`}
        onClick={handleOpen}
        className="flex flex-1 items-center gap-2 min-w-0 cursor-pointer"
      >
        <span className="w-16 shrink-0 text-xs text-muted-foreground">
          {issue.identifier}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{issue.title}</span>
          {childProgress && (
            <Badge
              variant="secondary"
              className="shrink-0 rounded-full bg-muted/60 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground"
            >
              <ProgressRing
                done={childProgress.done}
                total={childProgress.total}
                size={14}
              />
              {childProgress.done}/{childProgress.total}
            </Badge>
          )}
        </span>
        {issue.due_date && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDate(issue.due_date)}
          </span>
        )}
        {issue.assignee_type && issue.assignee_id && (
          <ActorAvatar
            actorType={issue.assignee_type}
            actorId={issue.assignee_id}
            size={20}
          />
        )}
      </a>
    </div>
  )
})
