import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Result } from 'better-result'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import { AppLink } from '../../navigation'
import { useNavigation } from '../../navigation'
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
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
import type { StructuredQuestion } from '@garden/app-state/chat'
import {
  ALL_STATUSES,
  STATUS_CONFIG,
  PRIORITY_ORDER,
  PRIORITY_CONFIG,
} from '@garden/core/issues/config'
import { buildIssueDeepLinkPath } from '@garden/core/issues/deep-link'
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
import { ContextualComposer } from './contextual-composer'
import { AgentStatusEntry } from './agent-status-entry'
import { ActiveRunPanel, LastRunSummary } from './active-run-panel'
import { RunPlanCard, type RunPlanTodo } from './run-plan-card'
import { WorkProductList } from './work-product-card'
import { TodoAgentHintDialog } from './todo-agent-hint-dialog'
import { ReactionBar } from '@garden/ui/components/common/reaction-bar'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { CreateIssueModal } from '../../modals/create-issue'
import { timeAgo } from '@garden/core/utils'
import { cn } from '@garden/ui/lib/utils'
import { useIssueSearch } from '../hooks/use-issue-search'
import { useIssueDetailData } from '../hooks/use-issue-detail-data'
import { api, sortSessions, type AgentChatSession } from '@/lib/api'
import {
  issueActiveRunOptions,
  issueKeys,
  issueWorkProductsOptions,
} from '@/lib/issues/queries'
import { inboxKeys } from '@/lib/inbox/queries'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'

import { ProgressRing } from './progress-ring'

const ISSUE_DETAIL_PAGE_SKELETON = 'issue-detail-page'
const ISSUE_DETAIL_REACTIONS_SKELETON = 'issue-detail-reactions'
const ISSUE_DETAIL_SUBSCRIBERS_SKELETON = 'issue-detail-subscribers'
const ISSUE_DETAIL_TIMELINE_SKELETON = 'issue-detail-timeline'

function chatThreadsQueryKey(workspaceId: string, userId: string) {
  return ['chat-threads', workspaceId, userId] as const
}

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

/**
 * Human label for why a participant is on the issue. Surfaced in the
 * participants popover so a tagged agent reads as "joined via mention" rather
 * than an opaque checkbox — ties the @mention → join model to the UI. Reasons
 * come from the issue_subscriber table (@garden/db/subscribers).
 */
const SUBSCRIBER_REASON_LABEL: Record<string, string> = {
  creator: 'Creator',
  assignee: 'Assignee',
  commenter: 'Commented',
  mentioned: 'Mentioned',
  manual: 'Added',
}

function subscriberReasonLabel(reason: string | undefined): string | null {
  if (!reason) return null
  return SUBSCRIBER_REASON_LABEL[reason] ?? null
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
      const toName =
        detailString('to_id') && detailString('to_type') && resolveActorName
          ? resolveActorName(detailString('to_type')!, detailString('to_id')!)
          : null
      if (toName) return `assigned to ${toName}`
      if (details.from_id && !details.to_id) return 'removed assignee'
      return 'changed assignee'
    }
    case 'due_date_changed': {
      const to = detailString('to')
      if (!to) return 'removed due date'
      const formatted = new Date(to).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
      return `set due date to ${formatted}`
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
    parentIssueId,
    parentIssue,
    childIssues,
    parentChildIssues,
    updateIssueMutation,
    deleteIssueMutation,
  } = useIssueDetailData(id)
  const isMobile = useIsMobile()
  const dock = useWorkspaceDock()
  const queryClient = useQueryClient()
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen)
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const contextRailIsOpen = contextRailOpen ?? true

  const openChatMutation = useMutation({
    mutationFn: async (input: {
      agentId: string
      optimisticThreadId: string
      workspaceId: string
    }) =>
      api.openChatForIssue({
        workspaceId: input.workspaceId,
        issueId: id,
        issueTitle: issue?.title ?? 'Issue chat',
        agentId: input.agentId,
        threadId: input.optimisticThreadId,
      }),
    onMutate: async (input) => {
      if (!issue || !user?.id) return null

      const queryKey = chatThreadsQueryKey(input.workspaceId, user.id)
      const previousSessions =
        queryClient.getQueryData<AgentChatSession[]>(queryKey)

      const now = new Date().toISOString()
      const optimisticSession: AgentChatSession = {
        id: input.optimisticThreadId,
        workspaceId: input.workspaceId,
        ownerUserId: user.id,
        title: issue.title,
        agentId: input.agentId,
        hostName: input.agentId,
        primary_issue_id: issue.id,
        runtime_kind: 'issue_run',
        runtime_key: issue.id,
        primaryIssue: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.status,
        },
        createdAt: now,
        updatedAt: now,
        lastMessage: '',
        archivedAt: null,
        status: 'idle',
        unread: false,
        optimistic: true,
      }

      queryClient.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        sortSessions([
          optimisticSession,
          ...current.filter((session) => session.id !== optimisticSession.id),
        ]),
      )

      dock?.openPanel({
        kind: 'chat',
        title: optimisticSession.title,
        entityId: optimisticSession.id,
      })

      return {
        optimisticThreadId: optimisticSession.id,
        previousSessions,
        queryKey,
      }
    },
    onSuccess: (session, _input, context) => {
      if (context) {
        queryClient.setQueryData<AgentChatSession[]>(
          context.queryKey,
          (current = []) =>
            sortSessions([
              session,
              ...current.filter(
                (item) =>
                  item.id !== context.optimisticThreadId &&
                  item.id !== session.id,
              ),
            ]),
        )
      }

      dock?.openPanel({
        kind: 'chat',
        title: session.title,
        entityId: session.id,
      })
    },
    onError: (err, _input, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previousSessions)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to open chat')
    },
  })

  const handleOpenChat = useCallback(() => {
    if (!issue) return
    if (issue.assignee_type !== 'agent' || !issue.assignee_id) {
      toast.error('Open chat is only available for agent-assigned issues')
      return
    }

    if (!user?.id) return

    openChatMutation.mutate({
      agentId: issue.assignee_id,
      optimisticThreadId: issue.id,
      workspaceId: issue.workspace_id,
    })
  }, [dock, issue, openChatMutation, queryClient, user?.id])

  const handleOpenIssues = useCallback(() => {
    dock?.openPanel({ kind: 'issues', title: 'Tasks' })
  }, [dock])

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile])
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [todoHintOpen, setTodoHintOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [parentIssueOpen, setParentIssueOpen] = useState(true)
  const [tokenUsageOpen, setTokenUsageOpen] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const didHighlightRef = useRef<string | null>(null)
  const [parentPickerOpen, setParentPickerOpen] = useState(false)
  const [childPickerOpen, setChildPickerOpen] = useState(false)
  const [createIssueOpen, setCreateIssueOpen] = useState(false)
  const [createIssueData, setCreateIssueData] = useState<Record<
    string,
    unknown
  > | null>(null)
  const openCreateIssue = useCallback(
    (data?: Record<string, unknown> | null) => {
      setCreateIssueData(data ?? null)
      setCreateIssueOpen(true)
    },
    [],
  )
  const closeCreateIssue = useCallback(() => {
    setCreateIssueOpen(false)
    setCreateIssueData(null)
  }, [])

  const {
    timeline,
    loading: timelineLoading,
    submitting: commentSubmitting,
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
      // Hint: assigning an agent to a todo issue won't trigger execution
      // until the issue is moved to an active status.
      if (
        updates.assignee_type === 'agent' &&
        updates.assignee_id &&
        issue.status === 'todo' &&
        localStorage.getItem('garden:todo-agent-hint-dismissed') !== 'true'
      ) {
        setTodoHintOpen(true)
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
  // Description uploads pass issueId so agents can list issue body attachments,
  // while the markdown still keeps the stable URL for inline rendering.
  const handleDescriptionUpload = useCallback(
    (file: File) => uploadWithToast(file, { issueId: id }),
    [id, uploadWithToast],
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
      else handleOpenIssues()
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
              <PropRow label="Generated">
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
                    <button
                      type="button"
                      onClick={handleOpenIssues}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      {workspace.name}
                    </button>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  </>
                )}
                <span className="shrink-0">{issue.identifier}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
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

                    {/* Open chat — switches the user from background-watching
                        to an active conversation with this issue's assigned
                        agent. Only available when the assignee is an agent. */}
                    {issue.assignee_type === 'agent' && issue.assignee_id ? (
                      <DropdownMenuItem
                        onClick={handleOpenChat}
                        disabled={openChatMutation.isPending}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {openChatMutation.isPending
                          ? 'Opening in chat…'
                          : 'Open in chat'}
                      </DropdownMenuItem>
                    ) : null}

                    {/* Create sub-issue */}
                    <DropdownMenuItem
                      onClick={() => {
                        openCreateIssue({
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

                    {/* Copy link */}
                    <DropdownMenuItem
                      onClick={() => {
                        if (!workspace) {
                          toast.error('Workspace unavailable')
                          return
                        }

                        const path = buildIssueDeepLinkPath(workspace.id, id)
                        const url = router.getShareableUrl
                          ? router.getShareableUrl(path)
                          : new URL(path, window.location.origin).toString()
                        void navigator.clipboard.writeText(url).then(
                          () => toast.success('Link copied'),
                          () => toast.error('Could not copy link'),
                        )
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

            <TodoAgentHintDialog
              open={todoHintOpen}
              onOpenChange={setTodoHintOpen}
              onDismissPermanently={() => {
                localStorage.setItem(
                  'garden:todo-agent-hint-dismissed',
                  'true',
                )
              }}
              onMoveToInProgress={() => {
                updateIssueMutation.mutate(
                  { id, status: 'in_progress' },
                  { onError: () => toast.error('Failed to update status') },
                )
                setTodoHintOpen(false)
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
                    {issue.assignee_type === 'agent' && issue.assignee_id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleOpenChat}
                        disabled={openChatMutation.isPending}
                        className="ml-auto h-7 gap-1.5 border-info/30 bg-info/5 text-info hover:bg-info/10 hover:text-info"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {openChatMutation.isPending
                          ? 'Opening in chat…'
                          : 'Open in chat'}
                      </Button>
                    ) : null}
                  </div>
                  {descDragOver && <FileDropOverlay />}
                </div>

                <div className="space-y-3">
                  <Suspense fallback={<IssueOutputSurfaceFallback />}>
                    <IssueOutputSurface issue={issue} />
                  </Suspense>
                  <Suspense fallback={<IssueRunSurfaceFallback />}>
                    <IssueRunSurface
                      issue={issue}
                      timeline={timeline}
                      onAnswerQuestion={(answer) => {
                        const content = Array.isArray(answer)
                          ? answer.join('\n')
                          : answer
                        void submitComment(content)
                      }}
                      answeringQuestion={commentSubmitting}
                    />
                  </Suspense>
                </div>

                {/* Sub-issues — Linear-style */}
                {childIssues.length === 0 && (
                  <div className="mt-6">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() =>
                        openCreateIssue({
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
                                    openCreateIssue({
                                      parent_issue_id: issue.id,
                                      parent_issue_identifier: issue.identifier,
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
                                                {isSubbed &&
                                                  subscriberReasonLabel(
                                                    sub?.reason,
                                                  ) && (
                                                    <span className="shrink-0 text-[10px] text-muted-foreground">
                                                      {subscriberReasonLabel(
                                                        sub?.reason,
                                                      )}
                                                    </span>
                                                  )}
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
                                                {isSubbed &&
                                                  subscriberReasonLabel(
                                                    sub?.reason,
                                                  ) && (
                                                    <span className="shrink-0 text-[10px] text-muted-foreground">
                                                      {subscriberReasonLabel(
                                                        sub?.reason,
                                                      )}
                                                    </span>
                                                  )}
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
                              .filter(
                                (e) => e.type === 'activity' || !e.parent_id,
                              )
                              // Most run events are noisy runtime telemetry.
                              // Failures are product-visible because they tell
                              // the user why assigned agent work did not start.
                              .filter(
                                (e) =>
                                  !isRunEventAction(e.action) ||
                                  debugMode ||
                                  isUserVisibleRunEventAction(e.action),
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
                              const keepSeparateForDebug =
                                debugMode && isRunEventAction(entry.action)
                              if (entry.type === 'activity') {
                                const prev = coalesced[coalesced.length - 1]
                                if (
                                  !keepSeparateForDebug &&
                                  prev?.type === 'activity' &&
                                  !(
                                    debugMode && isRunEventAction(prev.action)
                                  ) &&
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
                                if (entry.actor_type === 'agent') {
                                  return (
                                    <div
                                      key={entry.id}
                                      className="mb-3 last:mb-0"
                                    >
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
                                    const isRunFailure =
                                      entry.action === 'issue_run:failed'

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
                                        {debugMode && (
                                          <RunEventDebugDetails entry={entry} />
                                        )}
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

                  {/* Bottom composer — contextual, mode swaps by run state */}
                  <div className="sticky bottom-0 z-20 -mx-6 mt-4 px-6 pb-5 pt-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                    <ContextualComposer
                      issueId={id}
                      onSubmit={submitComment}
                      onOpenChat={
                        issue.assignee_type === 'agent' && issue.assignee_id
                          ? handleOpenChat
                          : undefined
                      }
                      openChatPending={openChatMutation.isPending}
                    />
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
            <Button variant="outline" size="sm" onClick={handleOpenIssues}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Back to Issues
            </Button>
          )}
        </div>
      ) : null}
      {createIssueOpen ? (
        <CreateIssueModal onClose={closeCreateIssue} data={createIssueData} />
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

function timelineRunEvents(timeline: TimelineEntry[]): IssueRunEvent[] {
  const out: IssueRunEvent[] = []
  for (const entry of timeline) {
    if (entry.type === 'activity' && entry.event) out.push(entry.event)
  }
  return out
}

function latestPlanFromEvents(events: IssueRunEvent[]): RunPlanTodo[] | null {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.event_type === 'issue_run:tool_started' &&
        payloadObject(candidate)?.tool === 'update_plan',
    )
  const payload = payloadObject(event)
  if (!payload) return null
  const input = payload.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const todosRaw = (input as Record<string, unknown>).todos
  if (!Array.isArray(todosRaw)) return null
  const todos: RunPlanTodo[] = []
  for (const item of todosRaw) {
    if (
      item &&
      typeof item === 'object' &&
      'content' in item &&
      typeof (item as { content: unknown }).content === 'string' &&
      'status' in item &&
      ((item as { status: unknown }).status === 'pending' ||
        (item as { status: unknown }).status === 'in_progress' ||
        (item as { status: unknown }).status === 'completed') &&
      'activeForm' in item &&
      typeof (item as { activeForm: unknown }).activeForm === 'string'
    ) {
      const cast = item as RunPlanTodo
      todos.push({
        content: cast.content,
        status: cast.status,
        activeForm: cast.activeForm,
      })
    }
  }
  return todos.length > 0 ? todos : null
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

function LastRunSummaryShell({
  pulse,
  children,
}: {
  pulse: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!pulse) return
    setActive(true)
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const timer = setTimeout(() => setActive(false), 1800)
    return () => clearTimeout(timer)
  }, [pulse])
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card px-3 py-2 transition-shadow',
        active && 'ring-2 ring-brand/60 ring-offset-2 ring-offset-background',
      )}
    >
      {children}
    </div>
  )
}

function latestEventSummary(events: IssueRunEvent[]) {
  const event = events[events.length - 1]
  if (!event) return null
  return event.message?.trim() || event.event_type
}

function OutputSection({ children }: { children: React.ReactNode }) {
  return <section className="mt-8 space-y-2">{children}</section>
}

function IssueOutputSurfaceFallback() {
  return (
    <section className="mt-8">
      <div className="rounded-lg border bg-card p-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-5/6" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </div>
    </section>
  )
}

function IssueRunSurfaceFallback() {
  return (
    <section className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <Skeleton className="mt-3 h-2 w-full" />
      </div>
    </section>
  )
}

function IssueOutputSurface({ issue }: { issue: Issue }) {
  const { searchParams } = useNavigation()
  const focus = searchParams.get('focus') ?? ''
  const [focusKind, focusId] = focus.split(':')
  const pulseWorkProductId =
    focusKind === 'wp_review' && focusId ? focusId : null
  const { data: workProducts } = useSuspenseQuery(
    issueWorkProductsOptions(issue.id),
  )

  if (workProducts.length === 0) return null

  return (
    <OutputSection>
      <WorkProductList
        workProducts={workProducts}
        connectorId={issue.source_summary?.connector_id ?? null}
        pulseId={pulseWorkProductId}
        onApprove={() => {}}
        onRequestChanges={() => {}}
        onApply={() => {}}
      />
    </OutputSection>
  )
}

function IssueRunSurface({
  issue,
  timeline,
  onAnswerQuestion,
  answeringQuestion = false,
}: {
  issue: Issue
  timeline: TimelineEntry[]
  onAnswerQuestion?: (answer: string | string[]) => void
  answeringQuestion?: boolean
}) {
  const queryClient = useQueryClient()
  const { searchParams } = useNavigation()
  const { data } = useSuspenseQuery(issueActiveRunOptions(issue.id))
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const focus = searchParams.get('focus') ?? ''
  const [focusKind, focusId] = focus.split(':')
  const run = data?.run ?? null
  const events = data?.events ?? []
  const persistedRunEvents = timelineRunEvents(timeline)
  const latestSeq = events.at(-1)?.seq ?? 0
  const latestRunStatus = run?.status ?? 'idle'
  useEffect(() => {
    if (!run) return
    queryClient.invalidateQueries({ queryKey: issueKeys.timeline(issue.id) })
    queryClient.invalidateQueries({
      queryKey: issueKeys.detail(issue.workspace_id, issue.id),
    })
    queryClient.invalidateQueries({
      queryKey: issueKeys.list(issue.workspace_id),
    })
    queryClient.invalidateQueries({
      queryKey: inboxKeys.list(issue.workspace_id),
    })
  }, [
    issue.id,
    issue.workspace_id,
    latestRunStatus,
    latestSeq,
    queryClient,
    run,
  ])
  const pendingQuestion = pendingQuestionFromEvents(events)
  const pendingApprovalPreview = pendingApprovalFromEvents(events)
  const plan = latestPlanFromEvents(
    persistedRunEvents.length > 0 ? persistedRunEvents : events,
  )
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
      focusKind === 'approval' ||
      (focusKind === 'run' && (!focusId || focusId === run?.id)))
  const pulseLastRun =
    Boolean(run) &&
    (focusKind === 'failed_run' || focusKind === 'blocked') &&
    (!focusId || focusId === run?.id)
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
          onAnswerQuestion={onAnswerQuestion}
          answering={answeringQuestion}
        />
      )}

      {plan && <RunPlanCard todos={plan} streaming={Boolean(showActive)} />}

      {showLastRun && run && (
        <LastRunSummaryShell pulse={pulseLastRun}>
          <LastRunSummary
            debugMode={debugMode}
            lastRun={{
              status: run.status,
              finished_at: run.finished_at,
              usage: run.usage ?? null,
            }}
          />
        </LastRunSummaryShell>
      )}
    </div>
  )
}
