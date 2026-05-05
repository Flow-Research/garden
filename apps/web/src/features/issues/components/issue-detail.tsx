'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Result } from 'better-result'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import { AppLink } from '../../navigation'
import { useNavigation } from '../../navigation'
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import { PageHeader } from '../../layout/page-header'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@garden/ui/components/ui/alert-dialog'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@garden/ui/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@garden/ui/components/ui/sheet'
import { useIsMobile } from '@garden/ui/hooks/use-mobile'
import {
  ContentEditor,
  type ContentEditorRef,
  TitleEditor,
  useFileDropZone,
  FileDropOverlay,
} from '../../editor'
import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@garden/ui/components/ui/popover'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@garden/ui/components/ui/command'
import { AvatarGroup, AvatarGroupCount } from '@garden/ui/components/ui/avatar'
import { ActorAvatar } from '../../common/actor-avatar'
import type {
  UpdateIssueRequest,
  IssueStatus,
  IssuePriority,
  TimelineEntry,
  Issue,
  IssueRunEvent,
} from '@garden/core/types'
import type { StructuredQuestion } from '@garden/core/chat'
import {
  ALL_STATUSES,
  STATUS_CONFIG,
  PRIORITY_ORDER,
  PRIORITY_CONFIG,
} from '@garden/core/issues/config'
import {
  StatusIcon,
  PriorityIcon,
  StatusPicker,
  PriorityPicker,
  DueDatePicker,
  AssigneePicker,
  canAssignAgent,
} from '.'
import { ProjectPicker } from '../../projects/components/project-picker'
import { CommentCard } from './comment-card'
import { CommentInput } from './comment-input'
import { ActiveRunPanel, LastRunSummary } from './active-run-panel'
import { WorkProductList } from './work-product-card'
import { BacklogAgentHintDialog } from './backlog-agent-hint-dialog'
import { ReactionBar } from '@garden/ui/components/common/reaction-bar'
import { useModalStore } from '@garden/core/modals'
import { timeAgo } from '@garden/core/utils'
import { cn } from '@garden/ui/lib/utils'
import { useIssueSearch } from '../hooks/use-issue-search'
import { useIssueDetailData } from '../hooks/use-issue-detail-data'
import { api } from '@/lib/api'
import { issueActiveRunOptions, issueKeys } from '@/lib/issues/queries'

import { ProgressRing } from './progress-ring'

const ISSUE_DETAIL_PAGE_SKELETON = 'issue-detail-page'
const ISSUE_DETAIL_REACTIONS_SKELETON = 'issue-detail-reactions'
const ISSUE_DETAIL_SUBSCRIBERS_SKELETON = 'issue-detail-subscribers'
const ISSUE_DETAIL_TIMELINE_SKELETON = 'issue-detail-timeline'

function shortDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

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
  const details = (entry.details ?? {}) as Record<string, string>
  switch (entry.action) {
    case 'created':
      return 'created this issue'
    case 'status_changed':
      return `changed status from ${statusLabel(details.from ?? '?')} to ${statusLabel(details.to ?? '?')}`
    case 'priority_changed':
      return `changed priority from ${priorityLabel(details.from ?? '?')} to ${priorityLabel(details.to ?? '?')}`
    case 'assignee_changed': {
      const isSelfAssign =
        details.to_type === entry.actor_type && details.to_id === entry.actor_id
      if (isSelfAssign) return 'self-assigned this issue'
      const toName =
        details.to_id && details.to_type && resolveActorName
          ? resolveActorName(details.to_type, details.to_id)
          : null
      if (toName) return `assigned to ${toName}`
      if (details.from_id && !details.to_id) return 'removed assignee'
      return 'changed assignee'
    }
    case 'due_date_changed': {
      if (!details.to) return 'removed due date'
      const formatted = new Date(details.to).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
      return `set due date to ${formatted}`
    }
    case 'title_changed':
      return `renamed this issue from "${details.from ?? '?'}" to "${details.to ?? '?'}"`
    case 'description_updated':
      return 'updated the description'
    case 'task_completed':
      return 'completed the task'
    case 'task_failed':
      return 'task failed'
    default:
      return entry.action ?? ''
  }
}

function isRunEventAction(action: string | undefined): boolean {
  return Boolean(action && action.startsWith('issue_run:'))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function IssueDetailPageFixture() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-sm text-muted-foreground">Issues</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm font-medium">GDN-14</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 space-y-6 p-8">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-foreground">
              Ship boneyard skeletons across the app
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Replace the hand-built placeholder system with colocated fixtures
              captured from the real layout.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-border/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Description
            </p>
            <p className="text-sm text-foreground">
              Keep the skeleton order with the UI file, then generate bones from
              a dedicated fixture route.
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Activity
              </span>
              <span className="text-xs text-muted-foreground">4 updates</span>
            </div>
            <IssueDetailTimelineFixture />
          </div>
        </div>
        <div className="w-64 border-l p-4">
          <div className="space-y-4">
            {[
              ['Status', 'In Progress'],
              ['Priority', 'High'],
              ['Assignee', 'Garden Agent'],
              ['Project', 'MVP'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-medium text-foreground">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function IssueDetailReactionsFixture() {
  return (
    <div className="flex items-center gap-1">
      {['👍 4', '👀 2'].map((reaction) => (
        <div
          key={reaction}
          className="inline-flex h-7 items-center rounded-full border border-border bg-accent px-3 text-xs text-foreground"
        >
          {reaction}
        </div>
      ))}
    </div>
  )
}

function IssueDetailSubscribersFixture() {
  return (
    <div className="flex items-center gap-2">
      <button className="text-xs text-muted-foreground">Unsubscribe</button>
      <div className="flex -space-x-1">
        {['A', 'M'].map((label) => (
          <div
            key={label}
            className="flex h-6 w-6 items-center justify-center rounded-full border bg-accent text-[10px] font-medium text-foreground"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

function IssueDetailTimelineFixture() {
  return (
    <div className="space-y-4">
      {[
        ['KG', 'Updated the rollout plan and capture route.'],
        ['AG', 'Connected boneyard to the web app runtime.'],
        ['KG', 'Queued the remaining page swaps.'],
      ].map(([actor, body]) => (
        <div key={body} className="flex items-start gap-3 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-foreground">
            {actor}
          </div>
          <div className="flex-1 rounded-lg border border-border/70 bg-card px-3 py-3">
            <p className="text-sm font-medium text-foreground">{actor}</p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function IssueDetailPageSkeleton() {
  const fixture = <IssueDetailPageFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_PAGE_SKELETON}
      loading
      fixture={fixture}
      className="flex flex-1 min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function IssueDetailReactionsSkeleton() {
  const fixture = <IssueDetailReactionsFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_REACTIONS_SKELETON}
      loading
      fixture={fixture}
      className="inline-flex"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function IssueDetailSubscribersSkeleton() {
  const fixture = <IssueDetailSubscribersFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_SUBSCRIBERS_SKELETON}
      loading
      fixture={fixture}
      className="inline-flex"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function IssueDetailTimelineSkeleton() {
  const fixture = <IssueDetailTimelineFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_TIMELINE_SKELETON}
      loading
      fixture={fixture}
      className="w-full"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

// ---------------------------------------------------------------------------
// Property row
// ---------------------------------------------------------------------------

function PropRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs truncate">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issue Picker Dialog
// ---------------------------------------------------------------------------

function IssuePickerDialog({
  open,
  onOpenChange,
  title,
  description,
  excludeIds,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  excludeIds: string[]
  onSelect: (issue: Issue) => void
}) {
  const { query, results, isLoading, setQuery, reset } = useIssueSearch({
    excludeIds,
  })

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      reset()
    }
  }, [open, reset])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search issues..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {isLoading && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          )}
          {!isLoading && query.trim() && results.length === 0 && (
            <CommandEmpty>No issues found.</CommandEmpty>
          )}
          {!isLoading && !query.trim() && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type to search issues
            </div>
          )}
          {results.length > 0 && (
            <CommandGroup>
              {results.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={issue.id}
                  onSelect={() => {
                    onSelect(issue)
                    onOpenChange(false)
                  }}
                >
                  <StatusIcon
                    status={issue.status}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="text-muted-foreground shrink-0">
                    {issue.identifier}
                  </span>
                  <span className="truncate">{issue.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IssueDetailProps {
  issueId: string
  onDelete?: () => void
  defaultSidebarOpen?: boolean
  /** When set, the issue detail will auto-scroll to this comment and briefly highlight it. */
  highlightCommentId?: string
  /**
   * Hide the right-hand properties pane (and its toggle icon).
   * Used by the inbox, where the issue detail is opened next to the inbox list
   * and the properties rail isn't relevant.
   */
  hideRightSidebar?: boolean
  /**
   * Override the action of the header's context-rail toggle.
   * Defaults to toggling the workspace sidebar (which collapses the inner
   * explore menu while keeping the icon strip visible). The inbox passes a
   * callback that collapses the in-page inbox list pane instead.
   */
  onToggleContextRail?: () => void
  /**
   * Visual state for the context-rail toggle when an override callback is
   * supplied. Ignored when `onToggleContextRail` is undefined (state is then
   * derived from the workspace sidebar).
   */
  contextRailOpen?: boolean
}

// ---------------------------------------------------------------------------
// IssueDetail
// ---------------------------------------------------------------------------

export function IssueDetail({
  issueId,
  onDelete,
  defaultSidebarOpen = false,
  highlightCommentId,
  hideRightSidebar = false,
  onToggleContextRail,
  contextRailOpen,
}: IssueDetailProps) {
  const id = issueId
  const router = useNavigation()
  const {
    user,
    workspace,
    members,
    agents,
    currentMemberRole,
    getActorName,
    uploadWithToast,
    issue,
    issueLoading,
    timelineState,
    issueReactionState,
    subscriberState,
    usage,
    createPin,
    deletePin,
    isPinned,
    parentIssueId,
    parentIssue,
    childIssues,
    parentChildIssues,
    updateIssueMutation,
    deleteIssueMutation,
  } = useIssueDetailData(id)
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen)
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const contextRailIsOpen = contextRailOpen ?? true

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile])
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [backlogHintOpen, setBacklogHintOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [parentIssueOpen, setParentIssueOpen] = useState(true)
  const [tokenUsageOpen, setTokenUsageOpen] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const didHighlightRef = useRef<string | null>(null)
  const [parentPickerOpen, setParentPickerOpen] = useState(false)
  const [childPickerOpen, setChildPickerOpen] = useState(false)

  const {
    timeline,
    loading: timelineLoading,
    submitComment,
    submitReply,
    editComment,
    deleteComment,
    toggleReaction: handleToggleReaction,
  } = timelineState

  const {
    reactions: issueReactions,
    loading: reactionsLoading,
    toggleReaction: handleToggleIssueReaction,
  } = issueReactionState

  const {
    subscribers,
    loading: subscribersLoading,
    isSubscribed,
    toggleSubscribe: handleToggleSubscribe,
    toggleSubscriber,
  } = subscriberState
  const [subIssuesCollapsed, setSubIssuesCollapsed] = useState(false)

  const loading = issueLoading
  const focus = router.searchParams.get('focus') ?? ''
  const [focusKind, focusId] = focus.split(':')
  const focusedCommentId =
    focusKind === 'comment' && focusId ? focusId : highlightCommentId

  // Scroll to highlighted comment once timeline loads (fire only once per focusedCommentId)
  useEffect(() => {
    if (!focusedCommentId || timeline.length === 0) return
    if (didHighlightRef.current === focusedCommentId) return
    const el = document.getElementById(`comment-${focusedCommentId}`)
    if (el) {
      didHighlightRef.current = focusedCommentId
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedId(focusedCommentId)
        const timer = setTimeout(() => setHighlightedId(null), 2000)
        return () => clearTimeout(timer)
      })
    }
  }, [focusedCommentId, timeline.length])

  const handleUpdateField = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      if (!issue) return
      updateIssueMutation.mutate(
        { id, ...updates },
        { onError: () => toast.error('Failed to update issue') },
      )
      // Hint: assigning an agent to a backlog issue won't trigger execution
      // until the issue is moved to an active status.
      if (
        updates.assignee_type === 'agent' &&
        updates.assignee_id &&
        issue.status === 'backlog' &&
        localStorage.getItem('garden:backlog-agent-hint-dismissed') !== 'true'
      ) {
        setBacklogHintOpen(true)
      }
    },
    [issue, id, updateIssueMutation],
  )

  const descEditorRef = useRef<ContentEditorRef>(null)
  const { isDragOver: descDragOver, dropZoneProps: descDropZoneProps } =
    useFileDropZone({
      onDrop: (files) =>
        files.forEach((f) => descEditorRef.current?.uploadFile(f)),
    })
  // Description uploads don't pass issueId — the URL lives in the markdown.
  // This avoids stale attachment records when users delete images from the editor.
  const handleDescriptionUpload = useCallback(
    (file: File) => uploadWithToast(file),
    [uploadWithToast],
  )

  const handleDelete = async () => {
    setDeleting(true)
    const deleteResult = await Result.tryPromise({
      try: async () => {
        await deleteIssueMutation.mutateAsync(issue!.id)
      },
      catch: (error) => error,
    })

    if (deleteResult.isOk()) {
      toast.success('Issue deleted')
      if (onDelete) onDelete()
      else router.push('/issues')
      return
    }

    toast.error('Failed to delete issue')
    setDeleting(false)
  }

  const sidebarContent = issue ? (
    <div className="space-y-5">
      {/* Properties */}
      <div>
        <button
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${propertiesOpen ? '' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setPropertiesOpen(!propertiesOpen)}
        >
          Properties
          <ChevronRight
            className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${propertiesOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {propertiesOpen && (
          <div className="space-y-0.5 pl-2">
            <PropRow label="Status">
              <StatusPicker
                status={issue!.status}
                onUpdate={handleUpdateField}
                align="start"
              />
            </PropRow>
            <PropRow label="Priority">
              <PriorityPicker
                priority={issue!.priority}
                onUpdate={handleUpdateField}
                align="start"
              />
            </PropRow>
            <PropRow label="Assignee">
              <AssigneePicker
                assigneeType={issue!.assignee_type}
                assigneeId={issue!.assignee_id}
                onUpdate={handleUpdateField}
                align="start"
              />
            </PropRow>
            <PropRow label="Due date">
              <DueDatePicker
                dueDate={issue!.due_date}
                onUpdate={handleUpdateField}
              />
            </PropRow>
            <PropRow label="Project">
              <ProjectPicker
                projectId={issue!.project_id}
                onUpdate={handleUpdateField}
              />
            </PropRow>
          </div>
        )}
      </div>

      {/* Parent issue */}
      {parentIssue && (
        <div>
          <button
            className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${parentIssueOpen ? '' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setParentIssueOpen(!parentIssueOpen)}
          >
            Parent issue
            <ChevronRight
              className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${parentIssueOpen ? 'rotate-90' : ''}`}
            />
          </button>
          {parentIssueOpen && (
            <div className="pl-2">
              <AppLink
                href={`/issues/${parentIssue.id}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 -mx-2 text-xs hover:bg-accent/50 transition-colors group"
              >
                <StatusIcon
                  status={parentIssue.status}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="text-muted-foreground shrink-0">
                  {parentIssue.identifier}
                </span>
                <span className="truncate group-hover:text-foreground">
                  {parentIssue.title}
                </span>
              </AppLink>
            </div>
          )}
        </div>
      )}

      {/* Details */}
      <div>
        <button
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${detailsOpen ? '' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          Details
          <ChevronRight
            className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${detailsOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {detailsOpen && (
          <div className="space-y-0.5 pl-2">
            <PropRow label="Created by">
              <ActorAvatar
                actorType={issue!.creator_type}
                actorId={issue!.creator_id}
                size={18}
              />
              <span className="truncate">
                {getActorName(issue!.creator_type, issue!.creator_id)}
              </span>
            </PropRow>
            <PropRow label="Created">
              <span className="text-muted-foreground">
                {shortDate(issue!.created_at)}
              </span>
            </PropRow>
            <PropRow label="Updated">
              <span className="text-muted-foreground">
                {shortDate(issue!.updated_at)}
              </span>
            </PropRow>
          </div>
        )}
      </div>

      {/* Token usage — debug-only. Users don't need to see input/output token
      breakdowns by default; engineers turn on debug in Settings. */}
      {debugMode && usage && usage.task_count > 0 && (
        <div>
          <button
            className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${tokenUsageOpen ? '' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTokenUsageOpen(!tokenUsageOpen)}
          >
            Token usage
            <ChevronRight
              className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${tokenUsageOpen ? 'rotate-90' : ''}`}
            />
          </button>
          {tokenUsageOpen && (
            <div className="space-y-0.5 pl-2">
              <PropRow label="Input">
                <span className="text-muted-foreground">
                  {formatTokenCount(usage.total_input_tokens)}
                </span>
              </PropRow>
              <PropRow label="Output">
                <span className="text-muted-foreground">
                  {formatTokenCount(usage.total_output_tokens)}
                </span>
              </PropRow>
              {(usage.total_cache_read_tokens > 0 ||
                usage.total_cache_write_tokens > 0) && (
                <PropRow label="Cache">
                  <span className="text-muted-foreground">
                    {formatTokenCount(usage.total_cache_read_tokens)} read /{' '}
                    {formatTokenCount(usage.total_cache_write_tokens)} write
                  </span>
                </PropRow>
              )}
              <PropRow label="Runs">
                <span className="text-muted-foreground">
                  {usage.task_count}
                </span>
              </PropRow>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_PAGE_SKELETON}
      loading={loading}
      // BoneyardSkeleton adds a wrapper div around children. Keep that wrapper
      // in the flex chain so the issue body remains height-capped and scrolls.
      className="flex flex-1 min-h-0 [&>[data-boneyard-content=true]]:flex [&>[data-boneyard-content=true]]:flex-1 [&>[data-boneyard-content=true]]:min-h-0"
    >
      {issue ? (
        <div className="flex flex-1 min-h-0">
          <div className="flex h-full flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
            <PageHeader className="gap-2 bg-background text-sm">
              {onToggleContextRail && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={contextRailIsOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        className={
                          contextRailIsOpen ? '' : 'text-muted-foreground'
                        }
                        onClick={onToggleContextRail}
                      >
                        <PanelLeft />
                      </Button>
                    }
                  />
                  <TooltipContent side="bottom">
                    Toggle context rail
                  </TooltipContent>
                </Tooltip>
              )}
              <div className="flex flex-1 items-center gap-1.5 min-w-0">
                {workspace && (
                  <>
                    <AppLink
                      href="/issues"
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      {workspace.name}
                    </AppLink>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  </>
                )}
                <span className="shrink-0">{issue.identifier}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          'text-muted-foreground',
                          isPinned && 'text-foreground',
                        )}
                        onClick={() => {
                          if (isPinned) {
                            deletePin.mutate({
                              itemType: 'issue',
                              itemId: issue.id,
                            })
                          } else {
                            createPin.mutate({
                              item_type: 'issue',
                              item_id: issue.id,
                            })
                          }
                        }}
                      >
                        {isPinned ? <PinOff /> : <Pin />}
                      </Button>
                    }
                  />
                  <TooltipContent side="bottom">
                    {isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                      >
                        <MoreHorizontal />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-auto">
                    {/* Status */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <StatusIcon
                          status={issue.status}
                          className="h-3.5 w-3.5"
                        />
                        Status
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {ALL_STATUSES.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => handleUpdateField({ status: s })}
                          >
                            <StatusIcon status={s} className="h-3.5 w-3.5" />
                            {STATUS_CONFIG[s].label}
                            {issue.status === s && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* Priority */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <PriorityIcon priority={issue.priority} />
                        Priority
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {PRIORITY_ORDER.map((p) => (
                          <DropdownMenuItem
                            key={p}
                            onClick={() => handleUpdateField({ priority: p })}
                          >
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_CONFIG[p].badgeBg} ${PRIORITY_CONFIG[p].badgeText}`}
                            >
                              <PriorityIcon
                                priority={p}
                                className="h-3 w-3"
                                inheritColor
                              />
                              {PRIORITY_CONFIG[p].label}
                            </span>
                            {issue.priority === p && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* Assignee */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <UserMinus className="h-3.5 w-3.5" />
                        Assignee
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem
                          onClick={() =>
                            handleUpdateField({
                              assignee_type: null,
                              assignee_id: null,
                            })
                          }
                        >
                          <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
                          Unassigned
                          {!issue.assignee_type && (
                            <span className="ml-auto text-xs text-muted-foreground">
                              ✓
                            </span>
                          )}
                        </DropdownMenuItem>
                        {members.map((m) => (
                          <DropdownMenuItem
                            key={m.user_id}
                            onClick={() =>
                              handleUpdateField({
                                assignee_type: 'member',
                                assignee_id: m.user_id,
                              })
                            }
                          >
                            <ActorAvatar
                              actorType="member"
                              actorId={m.user_id}
                              size={16}
                            />
                            {m.name}
                            {issue.assignee_type === 'member' &&
                              issue.assignee_id === m.user_id && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                  ✓
                                </span>
                              )}
                          </DropdownMenuItem>
                        ))}
                        {agents
                          .filter(
                            (a) =>
                              !a.archived_at &&
                              canAssignAgent(a, user?.id, currentMemberRole),
                          )
                          .map((a) => (
                            <DropdownMenuItem
                              key={a.id}
                              onClick={() =>
                                handleUpdateField({
                                  assignee_type: 'agent',
                                  assignee_id: a.id,
                                })
                              }
                            >
                              <ActorAvatar
                                actorType="agent"
                                actorId={a.id}
                                size={16}
                              />
                              {a.name}
                              {issue.assignee_type === 'agent' &&
                                issue.assignee_id === a.id && (
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    ✓
                                  </span>
                                )}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* Due date */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Calendar className="h-3.5 w-3.5" />
                        Due date
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem
                          onClick={() =>
                            handleUpdateField({
                              due_date: new Date().toISOString(),
                            })
                          }
                        >
                          Today
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const d = new Date()
                            d.setDate(d.getDate() + 1)
                            handleUpdateField({ due_date: d.toISOString() })
                          }}
                        >
                          Tomorrow
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const d = new Date()
                            d.setDate(d.getDate() + 7)
                            handleUpdateField({ due_date: d.toISOString() })
                          }}
                        >
                          Next week
                        </DropdownMenuItem>
                        {issue.due_date && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                handleUpdateField({ due_date: null })
                              }
                            >
                              Clear date
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    <DropdownMenuSeparator />

                    {/* Create sub-issue */}
                    <DropdownMenuItem
                      onClick={() => {
                        useModalStore.getState().open('create-issue', {
                          parent_issue_id: issue.id,
                          parent_issue_identifier: issue.identifier,
                        })
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create sub-issue
                    </DropdownMenuItem>

                    {/* Add as sub-issue of another issue */}
                    <DropdownMenuItem onClick={() => setParentPickerOpen(true)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                      Set parent issue...
                    </DropdownMenuItem>

                    {/* Add another issue as sub-issue */}
                    <DropdownMenuItem onClick={() => setChildPickerOpen(true)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                      Add sub-issue...
                    </DropdownMenuItem>

                    {/* Pin / Unpin */}
                    <DropdownMenuItem
                      onClick={() => {
                        if (isPinned) {
                          deletePin.mutate({
                            itemType: 'issue',
                            itemId: issue.id,
                          })
                        } else {
                          createPin.mutate({
                            item_type: 'issue',
                            item_id: issue.id,
                          })
                        }
                      }}
                    >
                      {isPinned ? (
                        <PinOff className="h-3.5 w-3.5" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                      {isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                    </DropdownMenuItem>

                    {/* Copy link */}
                    <DropdownMenuItem
                      onClick={() => {
                        const url = router.getShareableUrl
                          ? router.getShareableUrl(router.pathname)
                          : window.location.href
                        navigator.clipboard.writeText(url)
                        toast.success('Link copied')
                      }}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Copy link
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Delete */}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete issue
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {!hideRightSidebar && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={sidebarOpen ? 'secondary' : 'ghost'}
                          size="icon-sm"
                          className={sidebarOpen ? '' : 'text-muted-foreground'}
                          onClick={() => setSidebarOpen((open) => !open)}
                        >
                          <PanelRight />
                        </Button>
                      }
                    />
                    <TooltipContent side="bottom">
                      Toggle properties
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </PageHeader>

            {/* Delete confirmation dialog (controlled by state) */}
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete issue</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this issue and all its
                    comments. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {deleting ? 'Deleting...' : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <BacklogAgentHintDialog
              open={backlogHintOpen}
              onOpenChange={setBacklogHintOpen}
              onDismissPermanently={() => {
                localStorage.setItem(
                  'garden:backlog-agent-hint-dismissed',
                  'true',
                )
              }}
              onMoveToTodo={() => {
                updateIssueMutation.mutate(
                  { id, status: 'todo' },
                  { onError: () => toast.error('Failed to update status') },
                )
                setBacklogHintOpen(false)
              }}
            />

            {/* Set parent issue picker */}
            <IssuePickerDialog
              open={parentPickerOpen}
              onOpenChange={setParentPickerOpen}
              title="Set parent issue"
              description="Search for an issue to set as the parent of this issue"
              excludeIds={[id, ...childIssues.map((c) => c.id)]}
              onSelect={(selected) => {
                handleUpdateField({ parent_issue_id: selected.id })
                toast.success(`Set ${selected.identifier} as parent issue`)
              }}
            />

            {/* Add sub-issue picker */}
            <IssuePickerDialog
              open={childPickerOpen}
              onOpenChange={setChildPickerOpen}
              title="Add sub-issue"
              description="Search for an issue to add as a sub-issue"
              excludeIds={[
                id,
                ...(parentIssueId ? [parentIssueId] : []),
                ...childIssues.map((c) => c.id),
              ]}
              onSelect={(selected) => {
                updateIssueMutation.mutate(
                  { id: selected.id, parent_issue_id: id },
                  { onError: () => toast.error('Failed to add sub-issue') },
                )
                toast.success(`Added ${selected.identifier} as sub-issue`)
              }}
            />

            {/* Content — scrollable */}
            <div
              ref={scrollContainerRef}
              className="relative flex-1 overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-3xl px-6 py-5">
                <TitleEditor
                  key={`title-${id}`}
                  defaultValue={issue.title}
                  placeholder="Issue title"
                  className="w-full text-2xl font-bold leading-snug tracking-tight"
                  onBlur={(value) => {
                    const trimmed = value.trim()
                    if (trimmed && trimmed !== issue.title)
                      handleUpdateField({ title: trimmed })
                  }}
                />

                {parentIssue && (
                  <AppLink
                    href={`/issues/${parentIssue.id}`}
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group/parent"
                  >
                    <span className="font-medium shrink-0">Sub-issue of</span>
                    <StatusIcon
                      status={parentIssue.status}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    <span className="tabular-nums shrink-0">
                      {parentIssue.identifier}
                    </span>
                    <span className="truncate group-hover/parent:text-foreground">
                      {parentIssue.title}
                    </span>
                    {parentChildIssues.length > 0 &&
                      (() => {
                        const done = parentChildIssues.filter(
                          (c) => c.status === 'done',
                        ).length
                        return (
                          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 shrink-0">
                            <ProgressRing
                              done={done}
                              total={parentChildIssues.length}
                              size={11}
                            />
                            <span className="tabular-nums text-[10.5px] font-medium">
                              {done}/{parentChildIssues.length}
                            </span>
                          </span>
                        )
                      })()}
                  </AppLink>
                )}

                <div
                  {...descDropZoneProps}
                  className="relative mt-5 rounded-lg"
                >
                  <ContentEditor
                    ref={descEditorRef}
                    key={id}
                    defaultValue={issue.description || ''}
                    placeholder="Add description..."
                    onUpdate={(md) =>
                      handleUpdateField({ description: md || undefined })
                    }
                    onUploadFile={handleDescriptionUpload}
                    debounceMs={1500}
                  />

                  <div className="flex items-center gap-1 mt-3">
                    <BoneyardSkeleton
                      name={ISSUE_DETAIL_REACTIONS_SKELETON}
                      loading={reactionsLoading}
                      className="inline-flex"
                    >
                      {!reactionsLoading ? (
                        <ReactionBar
                          reactions={issueReactions}
                          currentUserId={user?.id}
                          onToggle={handleToggleIssueReaction}
                          getActorName={getActorName}
                        />
                      ) : null}
                    </BoneyardSkeleton>
                    <FileUploadButton
                      size="sm"
                      onSelect={(file) =>
                        descEditorRef.current?.uploadFile(file)
                      }
                    />
                  </div>
                  {descDragOver && <FileDropOverlay />}
                </div>

                {/* Sub-issues — Linear-style */}
                {childIssues.length === 0 && (
                  <div className="mt-6">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() =>
                        useModalStore.getState().open('create-issue', {
                          parent_issue_id: issue.id,
                          parent_issue_identifier: issue.identifier,
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add sub-issues</span>
                    </button>
                  </div>
                )}
                {childIssues.length > 0 &&
                  (() => {
                    const doneCount = childIssues.filter(
                      (c) => c.status === 'done',
                    ).length
                    return (
                      <div className="mt-10">
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() => setSubIssuesCollapsed((v) => !v)}
                            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
                          >
                            <ChevronDown
                              className={cn(
                                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                                subIssuesCollapsed && '-rotate-90',
                              )}
                            />
                            <span>Sub-issues</span>
                          </button>
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5">
                            <ProgressRing
                              done={doneCount}
                              total={childIssues.length}
                              size={11}
                            />
                            <span className="text-[11px] text-muted-foreground tabular-nums font-medium">
                              {doneCount}/{childIssues.length}
                            </span>
                          </div>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                  onClick={() =>
                                    useModalStore
                                      .getState()
                                      .open('create-issue', {
                                        parent_issue_id: issue.id,
                                        parent_issue_identifier:
                                          issue.identifier,
                                      })
                                  }
                                  aria-label="Add sub-issue"
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              }
                            />
                            <TooltipContent side="bottom">
                              Add sub-issue
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {/* List */}
                        {!subIssuesCollapsed && (
                          <div className="overflow-hidden rounded-lg border bg-card/30 divide-y divide-border/60">
                            {childIssues.map((child) => {
                              const isDone =
                                child.status === 'done' ||
                                child.status === 'cancelled'
                              return (
                                <AppLink
                                  key={child.id}
                                  href={`/issues/${child.id}`}
                                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50 transition-colors group/row"
                                >
                                  <StatusIcon
                                    status={child.status}
                                    className="h-[15px] w-[15px] shrink-0"
                                  />
                                  <span className="text-[11px] text-muted-foreground tabular-nums font-medium shrink-0">
                                    {child.identifier}
                                  </span>
                                  <span
                                    className={cn(
                                      'text-sm truncate flex-1',
                                      isDone
                                        ? 'text-muted-foreground'
                                        : 'group-hover/row:text-foreground',
                                    )}
                                  >
                                    {child.title}
                                  </span>
                                  {child.assignee_type && child.assignee_id ? (
                                    <ActorAvatar
                                      actorType={child.assignee_type}
                                      actorId={child.assignee_id}
                                      size={20}
                                      className="shrink-0"
                                    />
                                  ) : (
                                    <span
                                      aria-hidden
                                      className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 shrink-0"
                                    />
                                  )}
                                </AppLink>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                <div className="my-10 border-t" />

                {/* Activity / Comments */}
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-semibold">Activity</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <BoneyardSkeleton
                        name={ISSUE_DETAIL_SUBSCRIBERS_SKELETON}
                        loading={subscribersLoading}
                        className="inline-flex"
                      >
                        {!subscribersLoading ? (
                          <>
                            <button
                              onClick={handleToggleSubscribe}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {isSubscribed ? 'Unsubscribe' : 'Subscribe'}
                            </button>
                            <Popover>
                              <PopoverTrigger className="cursor-pointer hover:opacity-80 transition-opacity">
                                {subscribers.length > 0 ? (
                                  <AvatarGroup>
                                    {subscribers.slice(0, 4).map((sub) => (
                                      <ActorAvatar
                                        key={`${sub.user_type}-${sub.user_id}`}
                                        actorType={sub.user_type}
                                        actorId={sub.user_id}
                                        size={24}
                                      />
                                    ))}
                                    {subscribers.length > 4 && (
                                      <AvatarGroupCount>
                                        +{subscribers.length - 4}
                                      </AvatarGroupCount>
                                    )}
                                  </AvatarGroup>
                                ) : (
                                  <span className="flex items-center justify-center h-6 w-6 rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground">
                                    <Users className="h-3 w-3" />
                                  </span>
                                )}
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-64 p-0">
                                <Command>
                                  <CommandInput placeholder="Change subscribers..." />
                                  <CommandList className="max-h-64">
                                    <CommandEmpty>
                                      No results found
                                    </CommandEmpty>
                                    {members.length > 0 && (
                                      <CommandGroup heading="Members">
                                        {members
                                          .filter(
                                            (m, i, arr) =>
                                              arr.findIndex(
                                                (x) => x.user_id === m.user_id,
                                              ) === i,
                                          )
                                          .map((m) => {
                                            const sub = subscribers.find(
                                              (s) =>
                                                s.user_type === 'member' &&
                                                s.user_id === m.user_id,
                                            )
                                            const isSubbed = !!sub
                                            return (
                                              <CommandItem
                                                key={`member-${m.user_id}`}
                                                onSelect={() =>
                                                  toggleSubscriber(
                                                    m.user_id,
                                                    'member',
                                                    isSubbed,
                                                  )
                                                }
                                                className="flex items-center gap-2.5"
                                              >
                                                <Checkbox
                                                  checked={isSubbed}
                                                  className="pointer-events-none"
                                                />
                                                <ActorAvatar
                                                  actorType="member"
                                                  actorId={m.user_id}
                                                  size={22}
                                                />
                                                <span className="truncate flex-1">
                                                  {m.name}
                                                </span>
                                              </CommandItem>
                                            )
                                          })}
                                      </CommandGroup>
                                    )}
                                    {agents.filter((a) => !a.archived_at)
                                      .length > 0 && (
                                      <CommandGroup heading="Agents">
                                        {agents
                                          .filter((a) => !a.archived_at)
                                          .map((a) => {
                                            const sub = subscribers.find(
                                              (s) =>
                                                s.user_type === 'agent' &&
                                                s.user_id === a.id,
                                            )
                                            const isSubbed = !!sub
                                            return (
                                              <CommandItem
                                                key={`agent-${a.id}`}
                                                onSelect={() =>
                                                  toggleSubscriber(
                                                    a.id,
                                                    'agent',
                                                    isSubbed,
                                                  )
                                                }
                                                className="flex items-center gap-2.5"
                                              >
                                                <Checkbox
                                                  checked={isSubbed}
                                                  className="pointer-events-none"
                                                />
                                                <ActorAvatar
                                                  actorType="agent"
                                                  actorId={a.id}
                                                  size={22}
                                                />
                                                <span className="truncate flex-1">
                                                  {a.name}
                                                </span>
                                              </CommandItem>
                                            )
                                          })}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : null}
                      </BoneyardSkeleton>
                    </div>
                  </div>

                  <IssueFlowSurface issue={issue} />

                  {/* Timeline entries */}
                  <div>
                    <BoneyardSkeleton
                      name={ISSUE_DETAIL_TIMELINE_SKELETON}
                      loading={timelineLoading}
                      className="w-full"
                    >
                      {!timelineLoading
                        ? (() => {
                            const topLevel = timeline
                              .filter((e) => e.type === 'activity' || !e.parent_id)
                              // Run events (`issue_run:*`) are debug-only. Real users
                              // see comments + status changes; engineers turn on
                              // debug mode in settings to see tool calls.
                              .filter(
                                (e) =>
                                  !isRunEventAction(e.action) || debugMode,
                              )
                            const repliesByParent = new Map<
                              string,
                              TimelineEntry[]
                            >()
                            for (const e of timeline) {
                              if (e.type === 'comment' && e.parent_id) {
                                const list =
                                  repliesByParent.get(e.parent_id) ?? []
                                list.push(e)
                                repliesByParent.set(e.parent_id, list)
                              }
                            }

                            // Coalesce: same actor + same action within 2 min → keep last only
                            const COALESCE_MS = 2 * 60 * 1000
                            const coalesced: TimelineEntry[] = []
                            for (const entry of topLevel) {
                              if (entry.type === 'activity') {
                                const prev = coalesced[coalesced.length - 1]
                                if (
                                  prev?.type === 'activity' &&
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
                                const entry = group.entries[0]!
                                return (
                                  <div
                                    key={entry.id}
                                    id={`comment-${entry.id}`}
                                    className="mb-4 last:mb-0"
                                  >
                                    <CommentCard
                                      issueId={id}
                                      entry={entry}
                                      allReplies={repliesByParent}
                                      currentUserId={user?.id}
                                      onReply={submitReply}
                                      onEdit={editComment}
                                      onDelete={deleteComment}
                                      onToggleReaction={handleToggleReaction}
                                      highlightedCommentId={highlightedId}
                                    />
                                  </div>
                                )
                              }

                              return (
                                <div
                                  key={group.entries[0]!.id}
                                  className="mb-4 last:mb-0 px-4 flex flex-col gap-3"
                                >
                                  {group.entries.map((entry, _idx) => {
                                    const details = (entry.details ??
                                      {}) as Record<string, string>
                                    const isStatusChange =
                                      entry.action === 'status_changed'
                                    const isPriorityChange =
                                      entry.action === 'priority_changed'
                                    const isDueDateChange =
                                      entry.action === 'due_date_changed'

                                    let leadIcon: React.ReactNode
                                    if (isStatusChange && details.to) {
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
                                      <div
                                        key={entry.id}
                                        className="flex items-center text-xs text-muted-foreground"
                                      >
                                        <div className="mr-2 flex w-4 shrink-0 justify-center">
                                          {leadIcon}
                                        </div>
                                        <div className="flex min-w-0 flex-1 items-center gap-1">
                                          <span className="shrink-0 font-medium">
                                            {getActorName(
                                              entry.actor_type,
                                              entry.actor_id,
                                            )}
                                          </span>
                                          <span className="truncate">
                                            {formatActivity(
                                              entry,
                                              getActorName,
                                            )}
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
                                              {new Date(
                                                entry.created_at,
                                              ).toLocaleString()}
                                            </TooltipContent>
                                          </Tooltip>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })
                          })()
                        : null}
                    </BoneyardSkeleton>
                  </div>

                  {/* Bottom comment input — no avatar, full width */}
                  <div className="mt-4">
                    <CommentInput issueId={id} onSubmit={submitComment} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          {!isMobile && !hideRightSidebar && (
            <div
              style={{
                width: sidebarOpen ? 320 : 0,
                minWidth: 0,
                transition: 'width 200ms ease-linear',
              }}
              className="shrink-0 overflow-hidden border-l"
            >
              <div className="h-full w-[320px] overflow-y-auto p-4">
                {sidebarContent}
              </div>
            </div>
          )}
          {isMobile && !hideRightSidebar && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="w-[320px] overflow-y-auto p-4"
              >
                {sidebarContent}
              </SheetContent>
            </Sheet>
          )}
        </div>
      ) : !loading ? (
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>
            This issue does not exist or has been deleted in this workspace.
          </p>
          {!onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/issues')}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Back to Issues
            </Button>
          )}
        </div>
      ) : null}
    </BoneyardSkeleton>
  )
}

function payloadObject(event: IssueRunEvent | undefined) {
  return event?.payload &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload)
    ? event.payload
    : null
}

function pendingQuestionFromEvents(
  events: IssueRunEvent[],
): StructuredQuestion | null {
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.event_type === 'issue_run:input_requested')
  const payload = payloadObject(event)
  if (!payload || typeof payload.question !== 'string') return null

  const options = Array.isArray(payload.options)
    ? payload.options
        .filter(
          (option): option is { label: string; description?: string } =>
            option !== null &&
            typeof option === 'object' &&
            'label' in option &&
            typeof option.label === 'string',
        )
        .map((option) => ({
          label: option.label,
          ...(typeof option.description === 'string'
            ? { description: option.description }
            : {}),
        }))
    : []

  return {
    id:
      typeof payload.id === 'string'
        ? payload.id
        : (event?.run_id ?? 'question'),
    question: payload.question,
    options,
    ...(typeof payload.header === 'string' ? { header: payload.header } : {}),
    ...(typeof payload.multiSelect === 'boolean'
      ? { multiSelect: payload.multiSelect }
      : {}),
  }
}

function pendingApprovalFromEvents(events: IssueRunEvent[]) {
  const event = [...events]
    .reverse()
    .find(
      (candidate) => candidate.event_type === 'issue_run:approval_requested',
    )
  const payload = payloadObject(event)
  if (!payload || typeof payload.title !== 'string') return null
  return {
    title: payload.title,
    body: typeof payload.body === 'string' ? payload.body : '',
    ...(typeof payload.targetLabel === 'string'
      ? { targetLabel: payload.targetLabel }
      : {}),
  }
}

function latestEventSummary(events: IssueRunEvent[]) {
  const event = events[events.length - 1]
  if (!event) return null
  return event.message?.trim() || event.event_type
}

function IssueFlowSurface({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient()
  const { searchParams } = useNavigation()
  const { data } = useQuery(issueActiveRunOptions(issue.id))
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const focus = searchParams.get('focus') ?? ''
  const [focusKind, focusId] = focus.split(':')
  const run = data?.run ?? null
  const events = data?.events ?? []
  const pendingQuestion = pendingQuestionFromEvents(events)
  const pendingApprovalPreview = pendingApprovalFromEvents(events)
  const cancelMutation = useMutation({
    mutationFn: () => api.cancelRun(issue.id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: issueKeys.activeRun(issue.id),
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(issue.workspace_id, issue.id),
      })
      queryClient.invalidateQueries({ queryKey: issueKeys.timeline(issue.id) })
    },
    onError: () => toast.error('Failed to stop run'),
  })

  const pulseFocus =
    Boolean(run) &&
    ((focusKind === 'question' &&
      (!focusId || focusId === run?.id || focusId === pendingQuestion?.id)) ||
      focusKind === 'approval')
  const showActive =
    run &&
    run.status !== 'succeeded' &&
    run.status !== 'cancelled' &&
    run.status !== 'failed' &&
    run.status !== 'blocked'
  const showLastRun =
    run &&
    (run.status === 'succeeded' ||
      run.status === 'cancelled' ||
      run.status === 'failed' ||
      run.status === 'blocked')

  return (
    <div className="space-y-3">
      {showActive && run && (
        <ActiveRunPanel
          agent={{ name: 'Garden' }}
          run={{ ...run, usage: run.usage ?? null }}
          lastEventSummary={latestEventSummary(events)}
          pendingQuestion={pendingQuestion}
          pendingApprovalPreview={pendingApprovalPreview}
          pulseFocus={pulseFocus}
          debugMode={debugMode}
          onStop={() => cancelMutation.mutate()}
          onApprove={() => {}}
          onDeny={() => {}}
          onEditApprove={() => {}}
        />
      )}

      {showLastRun && run && (
        <div className="rounded-lg border bg-card px-3 py-2">
          <LastRunSummary
            debugMode={debugMode}
            lastRun={{
              status: run.status,
              finished_at: run.finished_at,
              usage: run.usage ?? null,
            }}
          />
        </div>
      )}

      {data && data.work_products.length > 0 && (
        <WorkProductList
          workProducts={data.work_products}
          connectorId={issue.source_summary?.connector_id ?? null}
          onApprove={() => {}}
          onRequestChanges={() => {}}
          onApply={() => {}}
        />
      )}
    </div>
  )
}
