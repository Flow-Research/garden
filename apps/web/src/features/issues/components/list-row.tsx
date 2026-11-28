import { memo, useCallback } from 'react'
import type { Issue } from '@garden/core/types'
import { ExternalLink, FileText } from 'lucide-react'
import { formatShortDate } from '@garden/core/format'
import { Badge } from '@garden/ui/components/ui/badge'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import { ActorAvatar } from '../../common/actor-avatar'
import { useIssueSelectionStore } from '@garden/app-state/issues/stores/selection-store'
import { PriorityIcon } from './priority-icon'
import { ProgressRing } from './progress-ring'
import { issuePath } from '@/features/navigation/use-surface-navigation'
import { StatusIcon } from './status-icon'

export interface ChildProgress {
  done: number
  total: number
}

/** Label for a Team or project in the Team issue list. */
function Chip({ children, dot }: { children: React.ReactNode; dot: string }) {
  return (
    <span className="inline-flex h-[30px] min-w-0 max-w-full items-center gap-1.5 rounded-pill border-[0.5px] border-border-default bg-background-main-default px-3 text-sm text-text-default">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      <span className="max-w-80 truncate">{children}</span>
    </span>
  )
}

export const ListRow = memo(function ListRow({
  issue,
  childProgress,
  team,
  project,
  variant = 'default',
  onOpen,
}: {
  issue: Issue
  childProgress?: ChildProgress
  /** Team chip for cross-team views (Teams › Issues). */
  team?: { name: string; color: string }
  /** Project chip for the Team list variant. */
  project?: { title: string; color: string }
  /**
   * `team` renders the design's issue row for the Team detail Issues tab:
   * muted status icon + title, then team/project/description chips — no
   * selection, identifier, priority, avatar, or due date.
   */
  variant?: 'default' | 'team'
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

  if (variant === 'team') {
    const href = issuePath(issue.id)
    return (
      <div className="flex min-h-[54px] items-center gap-3 px-6 py-3 text-sm max-xl:items-start max-xl:py-4 max-sm:px-4">
        <StatusIcon
          status={issue.status}
          className="size-4.5 shrink-0 text-icon-secondary max-xl:mt-0.5 max-xl:size-5"
          inheritColor
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <a
            href={href}
            onClick={handleOpen}
            className="min-w-0 grow basis-48 text-text-default max-xl:basis-full max-xl:wrap-break-word max-xl:font-semibold xl:truncate"
          >
            {issue.title}
          </a>
          {team ? <Chip dot={team.color}>{team.name}</Chip> : null}
          {project ? <Chip dot={project.color}>{project.title}</Chip> : null}
          {issue.description ? (
            <a
              href={href}
              onClick={handleOpen}
              className="flex h-[30px] min-w-0 max-w-full items-center gap-1.5 rounded-pill border-[0.5px] border-border-default bg-background-main-default px-3 text-text-default max-xl:h-auto max-xl:basis-full max-xl:gap-2 max-xl:py-2 max-xl:text-text-secondary"
            >
              <FileText aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate xl:max-w-80">
                {issue.description}
              </span>
              <ExternalLink aria-hidden className="size-4 shrink-0" />
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group/row flex h-9 items-center gap-2 px-4 text-sm transition-colors hover:bg-accent/50 ${
        selected ? 'bg-accent/30' : ''
      }`}
    >
      <div className="relative flex shrink-0 items-center justify-center size-4">
        <PriorityIcon
          priority={issue.priority}
          className={selected ? 'hidden' : 'group-hover/row:hidden'}
        />
        <Checkbox
          checked={selected}
          onCheckedChange={() => toggle(issue.id)}
          // Opacity, not display:none, so the checkbox stays reachable by
          // keyboard and shows when it has focus. It covers the priority icon.
          className={`absolute inset-0 size-4 ${selected ? '' : 'opacity-0 group-hover/row:opacity-100 focus-visible:bg-background focus-visible:opacity-100'}`}
          aria-label={selected ? 'Deselect issue' : 'Select issue'}
        />
      </div>
      <a
        href={issuePath(issue.id)}
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
        {team && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
            <span
              className="size-1.5 rounded-full"
              style={{ background: team.color }}
            />
            {team.name}
          </span>
        )}
        {issue.due_date && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatShortDate(issue.due_date)}
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
