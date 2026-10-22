import type { ComponentProps, ReactNode } from 'react'
import { Calendar, CircleAlert } from 'lucide-react'
import type {
  IssuePriority,
  IssueStatus,
  TimelineEntry,
} from '@garden/core/types'
import { PRIORITY_CONFIG, STATUS_CONFIG } from '@garden/core/issues/config'
import { formatShortDate, timeAgo } from '@garden/core/format'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@garden/ui/components/ui/tooltip'
import { cn } from '@garden/ui/lib/utils'
import { ActorAvatar } from '../../common/actor-avatar'
import { AgentStatusEntry } from './agent-status-entry'
import { CommentCard } from './comment-card'
import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'

type CommentCardProps = ComponentProps<typeof CommentCard>

function statusLabel(status: string): string {
  return STATUS_CONFIG[status as IssueStatus]?.label ?? status
}

function priorityLabel(priority: string): string {
  return PRIORITY_CONFIG[priority as IssuePriority]?.label ?? priority
}

function formatActivity(
  entry: TimelineEntry,
  resolveActorName?: (type: string, id: string) => string,
): string {
  const details = (entry.details ?? {}) as Record<string, unknown>
  const detailString = (key: string) =>
    typeof details[key] === 'string' ? details[key] : null
  switch (entry.action) {
    case 'created':
      return 'created this issue'
    case 'status_changed':
      return `changed status from ${statusLabel(detailString('from') ?? '?')} to ${statusLabel(detailString('to') ?? '?')}`
    case 'priority_changed':
      return `changed priority from ${priorityLabel(detailString('from') ?? '?')} to ${priorityLabel(detailString('to') ?? '?')}`
    case 'assignee_changed': {
      const isSelfAssign =
        details.to_type === entry.actor_type && details.to_id === entry.actor_id
      if (isSelfAssign) return 'self-assigned this issue'
      const toId = detailString('to_id')
      const toType = detailString('to_type')
      const toName =
        toId && toType && resolveActorName
          ? resolveActorName(toType, toId)
          : null
      if (toName) return `assigned to ${toName}`
      if (details.from_id && !details.to_id) return 'removed assignee'
      return 'changed assignee'
    }
    case 'due_date_changed': {
      const to = detailString('to')
      if (!to) return 'removed due date'
      return `set due date to ${formatShortDate(to)}`
    }
    case 'title_changed':
      return `renamed this issue from "${detailString('from') ?? '?'}" to "${detailString('to') ?? '?'}"`
    case 'description_updated':
      return 'updated the description'
    case 'task_completed':
      return 'completed the task'
    case 'task_failed':
      return 'task failed'
    case 'issue_run:queued':
      return 'queued an agent run'
    case 'issue_run:failed': {
      const error =
        detailString('error') ??
        detailString('message') ??
        entry.event?.message ??
        'Agent run failed'
      return `agent run failed: ${error}`
    }
    default:
      return entry.event?.message ?? entry.action ?? ''
  }
}

function isRunEventAction(action: string | undefined): boolean {
  return Boolean(action && action.startsWith('issue_run:'))
}

function isUserVisibleRunEventAction(action: string | undefined): boolean {
  return action === 'issue_run:failed'
}

function stringifyDebugValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value, null, 2)
}

function RunEventDebugDetails({ entry }: { entry: TimelineEntry }) {
  if (!entry.event || !isRunEventAction(entry.action)) return null
  const payload = entry.event.payload ?? entry.details ?? {}
  const payloadEntries = Object.entries(payload).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  )

  return (
    <div className="ml-6 mt-1 rounded-md border bg-muted/25 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>seq={entry.event.seq}</span>
        <span>stream={entry.event.stream}</span>
        <span>level={entry.event.level}</span>
        <span>type={entry.event.event_type}</span>
      </div>
      {payloadEntries.length > 0 && (
        <dl className="mt-1.5 grid gap-1">
          {payloadEntries.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2"
            >
              <dt className="truncate text-muted-foreground/75">{key}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words">
                {stringifyDebugValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/**
 * The issue's activity feed: comments (with threaded replies), agent status
 * entries and coalesced activity rows. Run telemetry is hidden unless it is a
 * user-visible failure or debug mode is on.
 */
export function IssueActivityTimeline({
  timeline,
  debugMode,
  highlightedId,
  issueId,
  currentUserId,
  getActorName,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  timeline: TimelineEntry[]
  debugMode: boolean
  highlightedId: string | null
  issueId: string
  currentUserId: string | undefined
  getActorName: (type: string, id: string) => string
  onReply: CommentCardProps['onReply']
  onEdit: CommentCardProps['onEdit']
  onDelete: CommentCardProps['onDelete']
  onToggleReaction: CommentCardProps['onToggleReaction']
}): ReactNode {
  const topLevel = timeline
    .filter((e) => e.type === 'activity' || !e.parent_id)
    // Most run events are noisy runtime telemetry.
    // Failures are product-visible because they tell
    // the user why assigned agent work did not start.
    .filter(
      (e) =>
        !isRunEventAction(e.action) ||
        debugMode ||
        isUserVisibleRunEventAction(e.action),
    )
  const repliesByParent = new Map<string, TimelineEntry[]>()
  for (const e of timeline) {
    if (e.type === 'comment' && e.parent_id) {
      const list = repliesByParent.get(e.parent_id) ?? []
      list.push(e)
      repliesByParent.set(e.parent_id, list)
    }
  }

  // Coalesce: same actor + same action within 2 min → keep last only
  const COALESCE_MS = 2 * 60 * 1000
  const coalesced: TimelineEntry[] = []
  for (const entry of topLevel) {
    const keepSeparateForDebug = debugMode && isRunEventAction(entry.action)
    if (entry.type === 'activity') {
      const prev = coalesced[coalesced.length - 1]
      if (
        !keepSeparateForDebug &&
        prev?.type === 'activity' &&
        !(debugMode && isRunEventAction(prev.action)) &&
        prev.action === entry.action &&
        prev.actor_type === entry.actor_type &&
        prev.actor_id === entry.actor_id &&
        Math.abs(
          new Date(entry.created_at).getTime() -
            new Date(prev.created_at).getTime(),
        ) <= COALESCE_MS
      ) {
        // Replace previous with this one (keep the later result)
        coalesced[coalesced.length - 1] = entry
        continue
      }
    }
    coalesced.push(entry)
  }

  // Group consecutive activities together so the connector line works
  const groups: {
    type: 'activities' | 'comment'
    entries: TimelineEntry[]
  }[] = []
  for (const entry of coalesced) {
    if (entry.type === 'activity') {
      const last = groups[groups.length - 1]
      if (last?.type === 'activities') {
        last.entries.push(entry)
      } else {
        groups.push({
          type: 'activities',
          entries: [entry],
        })
      }
    } else {
      groups.push({
        type: 'comment',
        entries: [entry],
      })
    }
  }

  return groups.map((group) => {
    if (group.type === 'comment') {
      const entry = group.entries[0]
      if (!entry) return null
      if (entry.actor_type === 'agent') {
        return (
          <div key={entry.id} className="mb-3 last:mb-0">
            <AgentStatusEntry
              entry={entry}
              highlighted={highlightedId === entry.id}
            />
          </div>
        )
      }
      return (
        <div
          key={entry.id}
          id={`comment-${entry.id}`}
          className="mb-4 last:mb-0"
        >
          <CommentCard
            issueId={issueId}
            entry={entry}
            allReplies={repliesByParent}
            currentUserId={currentUserId}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleReaction={onToggleReaction}
            highlightedCommentId={highlightedId}
          />
        </div>
      )
    }

    const first = group.entries[0]
    if (!first) return null

    return (
      <div key={first.id} className="mb-4 last:mb-0 px-4 flex flex-col gap-3">
        {group.entries.map((entry, _idx) => {
          const details = (entry.details ?? {}) as Record<string, string>
          const isStatusChange = entry.action === 'status_changed'
          const isPriorityChange = entry.action === 'priority_changed'
          const isDueDateChange = entry.action === 'due_date_changed'
          const isRunFailure = entry.action === 'issue_run:failed'

          let leadIcon: React.ReactNode
          if (isRunFailure) {
            leadIcon = (
              <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
            )
          } else if (isStatusChange && details.to) {
            leadIcon = (
              <StatusIcon
                status={details.to as IssueStatus}
                className="h-4 w-4 shrink-0"
              />
            )
          } else if (isPriorityChange && details.to) {
            leadIcon = (
              <PriorityIcon
                priority={details.to as IssuePriority}
                className="h-4 w-4 shrink-0"
              />
            )
          } else if (isDueDateChange) {
            leadIcon = (
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
            )
          } else {
            leadIcon = (
              <ActorAvatar
                actorType={entry.actor_type}
                actorId={entry.actor_id}
                size={16}
              />
            )
          }

          return (
            <div key={entry.id}>
              <div
                className={cn(
                  'flex items-center text-xs text-muted-foreground',
                  isRunFailure && 'text-destructive',
                )}
              >
                <div className="mr-2 flex w-4 shrink-0 justify-center">
                  {leadIcon}
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="shrink-0 font-medium">
                    {getActorName(entry.actor_type, entry.actor_id)}
                  </span>
                  <span className="truncate">
                    {formatActivity(entry, getActorName)}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="ml-auto shrink-0 cursor-default">
                          {timeAgo(entry.created_at)}
                        </span>
                      }
                    />
                    <TooltipContent side="top">
                      {new Date(entry.created_at).toLocaleString()}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {debugMode && <RunEventDebugDetails entry={entry} />}
            </div>
          )
        })}
      </div>
    )
  })
}
