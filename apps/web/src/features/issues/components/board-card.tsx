import { useCallback, memo } from 'react'
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import type { Issue, UpdateIssueRequest } from '@garden/core/types'
import { CalendarDays } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { ActorAvatar } from '../../common/actor-avatar'
import { useUpdateIssue } from '@/lib/issues/mutations'
import { PriorityIcon } from './priority-icon'
import { PriorityPicker, AssigneePicker, DueDatePicker } from './pickers'
import { PRIORITY_CONFIG } from '@garden/core/issues/config'
import { useViewStore } from '@garden/app-state/issues/stores/view-store-context'
import { ProgressRing } from './progress-ring'
import type { ChildProgress } from './list-row'
import { LiveDot } from './live-dot'
import { ConnectorIcon } from './connector-icon'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'

/**
 * Hook variant of `useUpdateIssue` for editable cards. Centralized here so the
 * presentational `BoardCardContent` stays decoupled from query-client / workspace
 * context — preview surfaces don't pay the cost.
 */
function useBoardCardUpdate(issueId: string) {
  const updateIssueMutation = useUpdateIssue()
  return useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      updateIssueMutation.mutate(
        { id: issueId, ...updates },
        { onError: () => toast.error('Failed to update issue') },
      )
    },
    [issueId, updateIssueMutation],
  )
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/** Stops event from bubbling to Link/drag handlers */
function PickerWrapper({ children }: { children: React.ReactNode }) {
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  return (
    <div onClick={stop} onMouseDown={stop} onPointerDown={stop}>
      {children}
    </div>
  )
}

export const BoardCardContent = memo(function BoardCardContent({
  issue,
  editable = false,
  childProgress,
  onUpdate,
}: {
  issue: Issue
  editable?: boolean
  childProgress?: ChildProgress
  /** Mutation handler for editable pickers. Required when `editable` is true.
   * Caller wires this (typically via `useUpdateIssue`); previews can omit it
   * and pass `editable={false}` to render in read-only mode without touching
   * any query / workspace context. */
  onUpdate?: (updates: Partial<UpdateIssueRequest>) => void
}) {
  const storeProperties = useViewStore((s) => s.cardProperties)
  const priorityCfg = PRIORITY_CONFIG[issue.priority]

  // Read-only safe default — pickers receive a no-op when not editable.
  const handleUpdate = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      onUpdate?.(updates)
    },
    [onUpdate],
  )

  const showPriority = storeProperties.priority
  const showDescription = storeProperties.description && issue.description
  const showAssignee =
    storeProperties.assignee && issue.assignee_type && issue.assignee_id
  const showDueDate = storeProperties.dueDate && issue.due_date

  const liveVariant: React.ComponentProps<typeof LiveDot>['variant'] | null =
    issue.active_run_id
      ? 'running'
      : issue.status === 'blocked'
        ? 'blocked'
        : null

  return (
    <div className="rounded-lg border bg-card p-3.5 shadow-[0_1px_2px_0_rgba(0,0,0,0.03)] transition-shadow group-hover:shadow-sm">
      {/* Row 1: Identifier + live indicators */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {issue.source_summary && (
          <ConnectorIcon
            connectorId={issue.source_summary.connector_id}
            size={11}
          />
        )}
        <span>{issue.identifier}</span>
        {liveVariant && <LiveDot variant={liveVariant} className="ml-0.5" />}
      </div>

      <p className="mt-1 text-sm font-medium leading-snug line-clamp-2">
        {issue.title}
      </p>

      {/* Sub-issue progress */}
      {childProgress && (
        <Badge
          variant="secondary"
          className="mt-1.5 rounded-full bg-muted/60 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground"
        >
          <ProgressRing
            done={childProgress.done}
            total={childProgress.total}
            size={14}
          />
          {childProgress.done}/{childProgress.total}
        </Badge>
      )}

      {/* Description */}
      {showDescription && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
          {issue.description}
        </p>
      )}

      {/* Row 3: Assignee, priority badge, due date */}
      {(showAssignee || showPriority || showDueDate) && (
        <div className="mt-3 flex items-center gap-2">
          {showAssignee &&
            (editable ? (
              <PickerWrapper>
                <AssigneePicker
                  assigneeType={issue.assignee_type}
                  assigneeId={issue.assignee_id}
                  onUpdate={handleUpdate}
                  trigger={
                    <ActorAvatar
                      actorType={issue.assignee_type!}
                      actorId={issue.assignee_id!}
                      size={22}
                    />
                  }
                />
              </PickerWrapper>
            ) : (
              <ActorAvatar
                actorType={issue.assignee_type!}
                actorId={issue.assignee_id!}
                size={22}
              />
            ))}
          {showPriority &&
            (editable ? (
              <PickerWrapper>
                <PriorityPicker
                  priority={issue.priority}
                  onUpdate={handleUpdate}
                  trigger={
                    <Badge
                      className={`rounded px-1.5 ${priorityCfg.badgeBg} ${priorityCfg.badgeText}`}
                    >
                      <PriorityIcon
                        priority={issue.priority}
                        className="h-3 w-3"
                        inheritColor
                      />
                      {priorityCfg.label}
                    </Badge>
                  }
                />
              </PickerWrapper>
            ) : (
              <Badge
                className={`rounded px-1.5 ${priorityCfg.badgeBg} ${priorityCfg.badgeText}`}
              >
                <PriorityIcon
                  priority={issue.priority}
                  className="h-3 w-3"
                  inheritColor
                />
                {priorityCfg.label}
              </Badge>
            ))}
          {showDueDate && (
            <div className="ml-auto">
              {editable ? (
                <PickerWrapper>
                  <DueDatePicker
                    dueDate={issue.due_date}
                    onUpdate={handleUpdate}
                    trigger={
                      <span
                        className={`flex items-center gap-1 text-xs ${
                          new Date(issue.due_date!) < new Date()
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        <CalendarDays className="size-3" />
                        {formatDate(issue.due_date!)}
                      </span>
                    }
                  />
                </PickerWrapper>
              ) : (
                <span
                  className={`flex items-center gap-1 text-xs ${
                    new Date(issue.due_date!) < new Date()
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }`}
                >
                  <CalendarDays className="size-3" />
                  {formatDate(issue.due_date!)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args
  if (isSorting || wasDragging) return false
  return defaultAnimateLayoutChanges(args)
}

export const DraggableBoardCard = memo(function DraggableBoardCard({
  issue,
  childProgress,
}: {
  issue: Issue
  childProgress?: ChildProgress
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { status: issue.status },
    animateLayoutChanges,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const dock = useWorkspaceDock()
  const handleUpdate = useBoardCardUpdate(issue.id)

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (isDragging) return
      dock?.openPanel({
        kind: 'issue-detail',
        title: issue.title,
        entityId: issue.id,
      })
    },
    [dock, issue.id, issue.title, isDragging],
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-30' : ''}
    >
      <a
        href={`/issues/${issue.id}`}
        onClick={handleOpen}
        className={`group block transition-colors cursor-pointer ${isDragging ? 'pointer-events-none' : ''}`}
      >
        <BoardCardContent
          issue={issue}
          editable
          childProgress={childProgress}
          onUpdate={handleUpdate}
        />
      </a>
    </div>
  )
})
