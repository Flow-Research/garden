import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { Result } from 'better-result'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import { AppLink, useNavigation } from '../../navigation'
import {
  ChevronDown,
  ChevronLeft,
  CalendarDays,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plus,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  STATUS_PILL_TEXT,
} from '@garden/core/issues/config'
import { DueDatePicker, PriorityPicker, StatusPicker } from './pickers'
import { Sheet, SheetContent } from '@garden/ui/components/ui/sheet'
import { useIsMobile } from '@garden/ui/hooks/use-mobile'
import {
  ContentEditor,
  type ContentEditorRef,
  useFileDropZone,
  FileDropOverlay,
} from '../../editor'
import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'
import { LoadError } from '@garden/ui/components/common/load-error'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { ActorAvatar } from '../../common/actor-avatar'
import type { UpdateIssueRequest } from '@garden/core/types'
import { useSurfaceTabsStore } from '@garden/app-state/surface-tabs'
import { buildIssueDeepLinkPath } from '@garden/core/issues/deep-link'
import { ContextualComposer } from './contextual-composer'
import { TodoAgentHintDialog } from './todo-agent-hint-dialog'
import { ReactionBar } from '@garden/ui/components/common/reaction-bar'
import { CreateIssueModal } from '../../modals/create-issue'
import { cn } from '@garden/ui/lib/utils'
import { useIssueDetailData } from '../hooks/use-issue-detail-data'
import { useOpenIssueChat } from '../hooks/use-open-issue-chat'
import {
  issuePath,
  useSurfaceNavigation,
} from '@/features/navigation/use-surface-navigation'

import { ProgressRing } from './progress-ring'
import { StatusIcon } from './status-icon'
import { IssueActionsMenu } from './issue-actions-menu'
import { IssueActivityTimeline } from './issue-activity-timeline'
import {
  DEFAULT_SIDEBAR_SECTIONS,
  IssueDetailSidebar,
  type IssueSidebarSection,
} from './issue-detail-sidebar'
import {
  ISSUE_DETAIL_PAGE_SKELETON,
  ISSUE_DETAIL_REACTIONS_SKELETON,
  ISSUE_DETAIL_SUBSCRIBERS_SKELETON,
  ISSUE_DETAIL_TIMELINE_SKELETON,
} from './issue-detail-skeletons'
import { IssuePickerDialog } from './issue-picker-dialog'
import {
  IssueOutputSurface,
  IssueOutputSurfaceFallback,
  IssueRunSurface,
  IssueRunSurfaceFallback,
} from './issue-run-surface'
import { IssueSubscribersControl } from './issue-subscribers-control'

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

/**
 * Inline title editor. Shows the live `title` until the user focuses it, then
 * holds their draft, so a title changed elsewhere mid-session is never
 * overwritten by a stale value on blur.
 */
function IssueTitleField({
  title,
  onSave,
}: {
  title: string
  onSave: (title: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const discardOnBlur = useRef(false)
  return (
    <textarea
      aria-label="Issue title"
      value={draft ?? title}
      placeholder="Issue title"
      rows={1}
      className="block field-sizing-content w-full min-w-0 resize-none border-0 bg-transparent p-0 text-lg font-bold leading-snug tracking-tight outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const trimmed = (draft ?? title).trim()
        setDraft(null)
        if (!discardOnBlur.current && trimmed && trimmed !== title)
          onSave(trimmed)
        discardOnBlur.current = false
      }}
      onKeyDown={(event) => {
        // Enter/Escape during IME composition confirm or cancel the candidate
        // text; they must not finish editing. Safari reports the committing
        // keydown with isComposing false but keyCode 229.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          discardOnBlur.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
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
    issueLoadFailed,
    retryIssue,
    retryingIssue,
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
  const { navigate } = useSurfaceNavigation()
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen)
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const contextRailIsOpen = contextRailOpen ?? true

  const { openChat: handleOpenChat, isPending: openChatPending } =
    useOpenIssueChat({ issueId: id, issue, userId: user?.id })

  const handleOpenIssues = useCallback(() => {
    void navigate({ to: '/tasks' })
  }, [navigate])

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile])
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [todoHintOpen, setTodoHintOpen] = useState(false)
  const [sidebarSections, setSidebarSections] = useState(
    DEFAULT_SIDEBAR_SECTIONS,
  )
  const toggleSidebarSection = useCallback(
    (section: IssueSidebarSection) =>
      setSidebarSections((current) => ({
        ...current,
        [section]: !current[section],
      })),
    [],
  )
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  // A tab switch shows the new tab from its start; scrolls only when the
  // tabs' top is already above the viewport, so it never jumps down. Panels
  // hide during base-ui's exit phase (`data-ending-style`); otherwise the
  // outgoing panel keeps its height for a frame and scroll anchoring shifts
  // the page once it unmounts.
  const scrollTabsToTop = () => {
    const container = scrollContainerRef.current
    const tabs = tabsRef.current
    if (!container || !tabs) return
    const offset =
      tabs.getBoundingClientRect().top - container.getBoundingClientRect().top
    if (offset < 0) container.scrollTop += offset
  }
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
    loadFailed: timelineLoadFailed,
    retrying: timelineRetrying,
    retryLoad: retryTimeline,
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
  const tabKey = `${id}:${focus}:${highlightCommentId ?? ''}`
  const [tabSelection, setTabSelection] = useState<{
    key: string
    tab: 'activity' | 'comments'
  } | null>(null)
  const activeTab =
    tabSelection?.key === tabKey
      ? tabSelection.tab
      : focusedCommentId
        ? 'comments'
        : 'activity'
  const commentCount = timeline.filter(
    (entry) => entry.type === 'comment',
  ).length

  // Scroll to highlighted comment once timeline loads (fire only once per focusedCommentId)
  useEffect(() => {
    if (!focusedCommentId || timeline.length === 0) return
    if (didHighlightRef.current === focusedCommentId) return
    const el = document.getElementById(`comment-${focusedCommentId}`)
    if (!el) return
    const frame = requestAnimationFrame(() => {
      didHighlightRef.current = focusedCommentId
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(focusedCommentId)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedCommentId, timeline.length])

  // Fade the highlight after 2s; cleared on unmount or a new highlight.
  useEffect(() => {
    if (!highlightedId) return
    const timer = setTimeout(() => setHighlightedId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedId])

  const openComment = (commentId: string) => {
    // Commit the Comments panel first so the reply is laid out before scrolling.
    flushSync(() => setTabSelection({ key: tabKey, tab: 'comments' }))
    document
      .getElementById(`comment-${commentId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(commentId)
  }

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
      // Close its tab — a persisted tab would route to a 404ing detail query.
      useSurfaceTabsStore.getState().closeTab('tasks', issue!.id)
      toast.success('Issue deleted')
      if (onDelete) onDelete()
      else handleOpenIssues()
      return
    }

    toast.error('Failed to delete issue')
    setDeleting(false)
  }

  const handleCopyLink = () => {
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
  }

  const sidebarContent = issue ? (
    <IssueDetailSidebar
      issue={issue}
      parentIssue={parentIssue}
      usage={usage}
      debugMode={debugMode}
      getActorName={getActorName}
      onUpdate={handleUpdateField}
      sections={sidebarSections}
      onToggleSection={toggleSidebarSection}
    />
  ) : null

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_PAGE_SKELETON}
      loading={loading}
      // BoneyardSkeleton adds a wrapper div around children. Keep that wrapper
      // in the flex chain so the issue body remains height-capped and scrolls.
      className="flex min-w-0 flex-1 min-h-0 [&>[data-boneyard-content=true]]:flex [&>[data-boneyard-content=true]]:min-w-0 [&>[data-boneyard-content=true]]:flex-1 [&>[data-boneyard-content=true]]:min-h-0"
    >
      {issue ? (
        <div className="flex min-w-0 flex-1 min-h-0">
          <div className="flex h-full flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
            <PageHeader className="h-auto min-h-12 flex-wrap gap-x-2 gap-y-1 bg-background px-3 py-2 text-sm sm:h-12 sm:flex-nowrap sm:px-4 sm:py-0">
              {onToggleContextRail && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="Toggle context rail"
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
              <div className="flex min-w-0 basis-[calc(100%-40px)] flex-1 items-center gap-1.5 overflow-x-auto text-xs sm:basis-auto">
                <button
                  type="button"
                  onClick={handleOpenIssues}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Tasks
                </button>
                <span className="mx-2 shrink-0 text-muted-foreground">/</span>
                {issue.team_id && (
                  <>
                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/teams' })}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      Teams
                    </button>
                    <span className="shrink-0 text-muted-foreground">/</span>
                    <button
                      type="button"
                      onClick={() => {
                        const teamId = issue.team_id
                        if (teamId)
                          void navigate({
                            to: '/teams/$teamId',
                            params: { teamId },
                            search: { tab: 'issues' },
                          })
                      }}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      Issues
                    </button>
                    <span className="shrink-0 text-muted-foreground">/</span>
                  </>
                )}
                <span className="shrink-0">{issue.identifier}</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openCreateIssue({
                      parent_issue_id: issue.id,
                      parent_issue_identifier: issue.identifier,
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  <span className="hidden sm:inline">New Sub-task</span>
                  <span className="sm:hidden">Sub-task</span>
                </Button>
                <IssueActionsMenu
                  issue={issue}
                  members={members}
                  agents={agents}
                  currentUserId={user?.id}
                  currentMemberRole={currentMemberRole}
                  onUpdate={handleUpdateField}
                  onOpenChat={handleOpenChat}
                  openChatPending={openChatPending}
                  onCreateSubIssue={() =>
                    openCreateIssue({
                      parent_issue_id: issue.id,
                      parent_issue_identifier: issue.identifier,
                    })
                  }
                  onSetParent={() => setParentPickerOpen(true)}
                  onAddSubIssue={() => setChildPickerOpen(true)}
                  onCopyLink={handleCopyLink}
                  onDelete={() => setDeleteDialogOpen(true)}
                />
                {!hideRightSidebar && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label="Toggle properties"
                          aria-expanded={sidebarOpen}
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
                localStorage.setItem('garden:todo-agent-hint-dismissed', 'true')
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
                // The success toast waits for the request; it used to show
                // before it, even when the update then failed.
                updateIssueMutation.mutate(
                  { id, parent_issue_id: selected.id },
                  {
                    onSuccess: () =>
                      toast.success(
                        `Set ${selected.identifier} as parent issue`,
                      ),
                    onError: () => toast.error('Failed to set parent issue'),
                  },
                )
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
                  {
                    onSuccess: () =>
                      toast.success(
                        `Added ${selected.identifier} as sub-issue`,
                      ),
                    onError: () => toast.error('Failed to add sub-issue'),
                  },
                )
              }}
            />

            {/* Content — scrollable */}
            <div
              ref={scrollContainerRef}
              className="relative flex-1 overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-[686px] px-4 pb-12 pt-6 sm:px-6 sm:pt-10">
                <IssueTitleField
                  key={`title-${id}`}
                  title={issue.title}
                  onSave={(title) => handleUpdateField({ title })}
                />

                {parentIssue && (
                  <AppLink
                    href={issuePath(parentIssue.id)}
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group/parent"
                  >
                    <span className="font-medium shrink-0">Sub-issue of</span>
                    <StatusIcon
                      status={parentIssue.status}
                      className="size-3.5 shrink-0"
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
                  className="relative mt-2 min-w-0 rounded-lg [overflow-wrap:anywhere]"
                >
                  <ContentEditor
                    ref={descEditorRef}
                    key={id}
                    defaultValue={issue.description || ''}
                    placeholder="Add description..."
                    className="text-xs leading-relaxed"
                    onUpdate={(md) => handleUpdateField({ description: md })}
                    onUploadFile={handleDescriptionUpload}
                    debounceMs={1500}
                  />

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <StatusPicker
                      status={issue.status}
                      onUpdate={handleUpdateField}
                      align="start"
                      triggerRender={
                        <Button
                          size="xs"
                          aria-label={`Status: ${STATUS_CONFIG[issue.status].label}`}
                          className={`h-5 gap-1.5 rounded-full px-2 text-[10px] hover:opacity-80 ${STATUS_PILL_TEXT}`}
                          style={{
                            backgroundColor:
                              STATUS_CONFIG[issue.status].pillFill,
                          }}
                        />
                      }
                      trigger={
                        <>
                          <StatusIcon
                            status={issue.status}
                            className={`size-3 ${STATUS_PILL_TEXT}`}
                          />
                          {STATUS_CONFIG[issue.status].label}
                        </>
                      }
                    />
                    <PriorityPicker
                      priority={issue.priority}
                      onUpdate={handleUpdateField}
                      align="start"
                      triggerRender={
                        <Button
                          size="xs"
                          aria-label={`Priority: ${PRIORITY_CONFIG[issue.priority].label}`}
                          className="h-5 rounded-full bg-foreground px-2 text-[10px] text-background hover:bg-foreground/80"
                        />
                      }
                      trigger={PRIORITY_CONFIG[issue.priority].label}
                    />
                    <DueDatePicker
                      dueDate={issue.due_date}
                      onUpdate={handleUpdateField}
                      triggerRender={
                        <Button
                          size="xs"
                          variant="outline"
                          aria-label="Change due date"
                          className="h-5 gap-1.5 rounded-full px-2 text-[10px]"
                        />
                      }
                      trigger={
                        <>
                          <CalendarDays className="size-3" />
                          {issue.due_date
                            ? `Due: ${new Date(issue.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
                            : 'Due date'}
                        </>
                      }
                    />
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
                        disabled={openChatPending}
                        className="ml-auto h-7 gap-1.5 border-info/30 bg-info/5 text-info hover:bg-info/10 hover:text-info"
                      >
                        <MessageSquare className="size-3.5" />
                        {openChatPending ? 'Opening in chat…' : 'Open in chat'}
                      </Button>
                    ) : null}
                  </div>
                  {descDragOver && <FileDropOverlay />}
                </div>

                <div className="space-y-3">
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
                                'size-3.5 text-muted-foreground transition-transform',
                                subIssuesCollapsed && '-rotate-90',
                              )}
                            />
                            <span>Sub-tasks</span>
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
                                  className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                  onClick={() =>
                                    openCreateIssue({
                                      parent_issue_id: issue.id,
                                      parent_issue_identifier: issue.identifier,
                                    })
                                  }
                                  aria-label="Add sub-issue"
                                >
                                  <Plus className="size-4" />
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
                                  href={issuePath(child.id)}
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
                                      className="size-5 rounded-full border border-dashed border-muted-foreground/30 shrink-0"
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

                <Tabs
                  ref={tabsRef}
                  value={activeTab}
                  onValueChange={(value) => {
                    if (value !== 'activity' && value !== 'comments') return
                    // Commit the new panel first so the scroll measures its layout.
                    flushSync(() =>
                      setTabSelection({ key: tabKey, tab: value }),
                    )
                    scrollTabsToTop()
                  }}
                  className="min-w-0 gap-5"
                >
                  <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-background py-3">
                    <TabsList
                      variant="line"
                      aria-label="Task activity"
                      className="h-8 gap-0 bg-background-main-default-hover p-0"
                    >
                      <TabsTrigger
                        value="activity"
                        className="h-8 rounded-none px-3 text-xs font-normal sm:px-4 after:bottom-0 after:h-px after:bg-brand"
                      >
                        Activity
                      </TabsTrigger>
                      <TabsTrigger
                        value="comments"
                        className="h-8 rounded-none px-3 text-xs font-normal sm:px-4 after:bottom-0 after:h-px after:bg-brand"
                      >
                        Comments
                      </TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-2">
                      <BoneyardSkeleton
                        name={ISSUE_DETAIL_SUBSCRIBERS_SKELETON}
                        loading={subscribersLoading}
                        className="inline-flex items-center gap-2"
                      >
                        {!subscribersLoading ? (
                          <IssueSubscribersControl
                            subscribers={subscribers}
                            isSubscribed={isSubscribed}
                            onToggleSubscribe={handleToggleSubscribe}
                            onToggleSubscriber={toggleSubscriber}
                            members={members}
                            agents={agents}
                          />
                        ) : null}
                      </BoneyardSkeleton>
                    </div>
                  </div>
                  <TabsContent
                    value="activity"
                    className="min-h-[196px] min-w-0 space-y-6 rounded-md data-[ending-style]:hidden bg-background-main-default-hover p-3 sm:p-5"
                  >
                    {activeTab === 'activity' && (
                      <>
                        <Suspense fallback={<IssueOutputSurfaceFallback />}>
                          <IssueOutputSurface issue={issue} />
                        </Suspense>
                        <BoneyardSkeleton
                          name={ISSUE_DETAIL_TIMELINE_SKELETON}
                          loading={timelineLoading}
                          className="w-full"
                        >
                          {timelineLoadFailed ? (
                            <LoadError
                              message="Could not load activity."
                              onRetry={retryTimeline}
                              retrying={timelineRetrying}
                            />
                          ) : !timelineLoading ? (
                            <IssueActivityTimeline
                              timeline={timeline}
                              debugMode={debugMode}
                              highlightedId={highlightedId}
                              issueId={id}
                              currentUserId={user?.id}
                              getActorName={getActorName}
                              onReply={submitReply}
                              onEdit={editComment}
                              onDelete={deleteComment}
                              onToggleReaction={handleToggleReaction}
                              onOpenComment={openComment}
                            />
                          ) : null}
                        </BoneyardSkeleton>
                      </>
                    )}
                  </TabsContent>
                  <TabsContent
                    value="comments"
                    keepMounted
                    className="min-w-0 space-y-5 rounded-md bg-background-main-default-hover p-3 data-[ending-style]:hidden sm:p-6"
                  >
                    <h2 className="text-sm font-semibold">
                      Comments ({commentCount})
                    </h2>
                    {/* Stays mounted while hidden so in-progress comment edits and
                        reply drafts survive a switch to Activity. */}
                    <BoneyardSkeleton
                      name={ISSUE_DETAIL_TIMELINE_SKELETON}
                      loading={timelineLoading}
                      className="w-full"
                    >
                      {timelineLoadFailed ? (
                        <LoadError
                          message="Could not load comments."
                          onRetry={retryTimeline}
                          retrying={timelineRetrying}
                        />
                      ) : !timelineLoading ? (
                        <IssueActivityTimeline
                          timeline={timeline}
                          view="comments"
                          debugMode={debugMode}
                          highlightedId={highlightedId}
                          issueId={id}
                          currentUserId={user?.id}
                          getActorName={getActorName}
                          onReply={submitReply}
                          onEdit={editComment}
                          onDelete={deleteComment}
                          onToggleReaction={handleToggleReaction}
                        />
                      ) : null}
                    </BoneyardSkeleton>
                    <div className="sticky bottom-0 z-10 -mx-3 -mb-3 flex items-start gap-3 rounded-b-md border-t bg-background-main-default-hover px-3 py-3 sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-4">
                      {user && (
                        <ActorAvatar
                          actorType="member"
                          actorId={user.id}
                          size={24}
                          className="mt-2 shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <ContextualComposer
                          key={id}
                          issueId={id}
                          onSubmit={submitComment}
                          onOpenChat={
                            issue.assignee_type === 'agent' && issue.assignee_id
                              ? handleOpenChat
                              : undefined
                          }
                          openChatPending={openChatPending}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
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
              // Collapsed to zero width but still focusable, Tab used to walk
              // into the invisible pickers.
              inert={sidebarOpen ? undefined : true}
              data-testid="issue-detail-sidebar"
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
                aria-label="Task properties"
                className="w-full max-w-[320px] overflow-y-auto p-4 data-[side=right]:w-full"
              >
                {sidebarContent}
              </SheetContent>
            </Sheet>
          )}
        </div>
      ) : issueLoadFailed ? (
        <div className="flex flex-1 min-h-0 items-center justify-center p-8">
          <LoadError
            message="Could not load this issue."
            onRetry={retryIssue}
            retrying={retryingIssue}
          />
        </div>
      ) : !loading ? (
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>
            This issue does not exist or has been deleted in this workspace.
          </p>
          {!onDelete && (
            <Button variant="outline" size="sm" onClick={handleOpenIssues}>
              <ChevronLeft className="mr-1 size-3.5" />
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
