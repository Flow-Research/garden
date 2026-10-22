import { useCallback, memo } from 'react'
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import type { Issue, IssuePriority, UpdateIssueRequest } from '@garden/core/types'
import { Badge } from '@garden/ui/components/ui/badge'
import { ActorAvatar } from '../../common/actor-avatar'
import { useUpdateIssue } from '@/lib/issues/mutations'
import { PriorityPicker, AssigneePicker, DueDatePicker } from './pickers'
import { PRIORITY_CONFIG } from '@garden/core/issues/config'
import { useViewStore } from '@garden/app-state/issues/stores/view-store-context'
import { ProgressRing } from './progress-ring'
import type { ChildProgress } from './list-row'
import { LiveDot } from './live-dot'
import { ConnectorIcon } from './connector-icon'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'

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

/** Design's solid priority pill fills (Global util colors — constant in both themes). */
const PRIORITY_PILL: Record<IssuePriority, { bg: string; text: string }> = {
  urgent: { bg: 'var(--util-color-19)', text: 'text-white' },
  high: { bg: 'var(--util-color-18)', text: 'text-white' },
  medium: { bg: 'var(--util-color-17)', text: 'text-white' },
  low: { bg: 'var(--util-color-16)', text: 'text-white' },
  none: { bg: 'var(--util-color-15)', text: 'text-gray-900' },
}

/** Solid priority pill per the design (util-color fill, label only). */
function PriorityPill({ priority }: { priority: IssuePriority }) {
  const pill = PRIORITY_PILL[priority]
  return (
    <span
      className={`inline-flex h-6 items-center rounded-pill px-2 text-xs ${pill.text}`}
      style={{ backgroundColor: pill.bg }}
    >
      {PRIORITY_CONFIG[priority].label}
    </span>
  )
}

/** Design's due-date format: "Due: 02 Jan, 2026". */
function formatDueDate(date: string): string {
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, '0')
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${day} ${month}, ${d.getFullYear()}`
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
  projectTitle,
  team,
  onUpdate,
}: {
  issue: Issue
  editable?: boolean
  childProgress?: ChildProgress
  /** Project title for the footer chip; undefined renders "No project". */
  projectTitle?: string
  /** Team chip for cross-team boards (Teams › Tasks); omitted elsewhere. */
  team?: { name: string; color: string }
  /** Mutation handler for editable pickers. Required when `editable` is true.
   * Caller wires this (typically via `useUpdateIssue`); previews can omit it
   * and pass `editable={false}` to render in read-only mode without touching
   * any query / workspace context. */
  onUpdate?: (updates: Partial<UpdateIssueRequest>) => void
}) {
  const storeProperties = useViewStore((s) => s.cardProperties)

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
    <div className="rounded-md border-[0.5px] border-border-default bg-background-main-default p-3">
      {/* Row 1: Identifier + live indicators + team chip (cross-team only) */}
      <div className="flex items-center gap-1.5 text-xs text-text-brand-default">
        {issue.source_summary && (
          <ConnectorIcon
            connectorId={issue.source_summary.connector_id}
            size={11}
          />
        )}
        <span>{issue.identifier}</span>
        {liveVariant && <LiveDot variant={liveVariant} className="ml-0.5" />}
        {team ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[0.5px] border-border-default bg-background-main-default px-2 py-0.5 text-xs text-text-default">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: team.color }}
            />
            {team.name}
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-sm font-semibold leading-snug line-clamp-2">
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
        <p className="mt-1 text-sm text-text-secondary line-clamp-3">
          {issue.description}
        </p>
      )}

      {/* Footer: priority pill, due-date chip, project chip, assignee */}
      <div className="mt-3 flex items-center gap-1.5">
        {showPriority &&
          (editable ? (
            <PickerWrapper>
              <PriorityPicker
                priority={issue.priority}
                onUpdate={handleUpdate}
                trigger={<PriorityPill priority={issue.priority} />}
              />
            </PickerWrapper>
          ) : (
            <PriorityPill priority={issue.priority} />
          ))}
        {showDueDate &&
          (editable ? (
            <PickerWrapper>
              <DueDatePicker
                dueDate={issue.due_date}
                onUpdate={handleUpdate}
                trigger={
                  <span className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-pill border-[0.5px] border-border-default bg-background-main-default px-2 text-xs text-text-default">
                    Due: {formatDueDate(issue.due_date!)}
                  </span>
                }
              />
            </PickerWrapper>
          ) : (
            <span className="inline-flex h-6 items-center gap-1 rounded-pill border-[0.5px] border-border-default bg-background-main-default px-2 text-xs text-text-default">
              Due: {formatDueDate(issue.due_date!)}
            </span>
          ))}
        <span className="inline-flex h-6 items-center gap-1 truncate rounded-pill border-[0.5px] border-border-default bg-background-main-default px-2 text-xs text-text-default">
          {projectTitle ?? 'No project'}
        </span>
        {showAssignee && (
          <div className="ml-auto">
            {editable ? (
              <PickerWrapper>
                <AssigneePicker
                  assigneeType={issue.assignee_type}
                  assigneeId={issue.assignee_id}
                  teamId={issue.team_id}
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
            )}
          </div>
        )}
      </div>
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
  projectTitle,
  team,
}: {
  issue: Issue
  childProgress?: ChildProgress
  projectTitle?: string
  team?: { name: string; color: string }
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

  const { openIssue } = useSurfaceNavigation()
  const handleUpdate = useBoardCardUpdate(issue.id)

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (isDragging) return
      openIssue({ id: issue.id, title: issue.title })
    },
    [openIssue, issue.id, issue.title, isDragging],
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
          projectTitle={projectTitle}
          team={team}
          onUpdate={handleUpdate}
        />
      </a>
    </div>
  )
})
