import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { Result } from 'better-result'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import { AppLink } from '../../navigation'
import { useNavigation } from '../../navigation'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
              <div className="flex flex-1 items-center gap-1.5 min-w-0">
                {issue?.team_id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/teams' })}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      Teams
                    </button>
                    <span className="text-muted-foreground/50 shrink-0">/</span>
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: '/teams/$teamId',
                          params: { teamId: issue.team_id as string },
                          search: { tab: 'issues' },
                        })
                      }
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      Issues
                    </button>
                    <span className="text-muted-foreground/50 shrink-0">/</span>
                  </>
                ) : workspace ? (
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
                ) : null}
                <span className="shrink-0">{issue.identifier}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
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
                    href={issuePath(parentIssue.id)}
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
                    onUpdate={(md) => handleUpdateField({ description: md })}
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
                        disabled={openChatPending}
                        className="ml-auto h-7 gap-1.5 border-info/30 bg-info/5 text-info hover:bg-info/10 hover:text-info"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {openChatPending ? 'Opening in chat…' : 'Open in chat'}
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

                  {/* Timeline entries */}
                  <div>
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
                        />
                      ) : null}
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
                      openChatPending={openChatPending}
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
