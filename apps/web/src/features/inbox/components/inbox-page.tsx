import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { inboxListOptions, deduplicateInboxItems } from '@/lib/inbox/queries'
import {
  useMarkInboxRead,
  useArchiveInbox,
  useMarkAllInboxRead,
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
} from '@/lib/inbox/mutations'
import { useActorName } from '@/lib/workspace/hooks'
import { useNavigation } from '../../navigation'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'
import { toast } from 'sonner'
import {
  MoreHorizontal,
  CheckCheck,
  Archive,
  BookCheck,
  ListChecks,
  ArrowLeft,
  ExternalLink,
  Bot,
  PanelLeftClose,
  SquarePen,
} from 'lucide-react'
import type { InboxItem } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@garden/ui/components/ui/dropdown-menu'
import { InboxListItem, timeAgo } from './inbox-list-item'
import { typeLabels } from './inbox-detail-label'
import { InboxItemPreviewCard, ctaForInboxItem } from './inbox-item-preview'
import { InboxControlPlane } from './inbox-control-plane'
import {
  MailComposer,
  MailAgentConversationPanel,
  MailAgentPane,
  MailConversationDetail,
  MailConversationList,
  MailConversationRow,
  MailDetailSkeleton,
  MailDetailToolbar,
  MailEmptyState,
  MailErrorState,
  MailListToolbar,
  MailNoSelectionState,
  MailSplitView,
  type MailConversationSummaryView,
  type MailConversationView,
  type MailScope,
} from './mail'
import {
  eligibleMailAgentsOptions,
  mailAgentSessionOptions,
} from '../mail.queries'
import {
  type ActiveMailInboxController,
  type MailInboxController,
  useMailInboxController,
} from '../mail-inbox-controller'
import {
  type GmailImportController,
  unavailableGmailImportController,
} from '../gmail-import-controller'
import { GmailImportControl } from './gmail-import-control'

const NO_INBOX_SELECTION = 'none'

// ---------------------------------------------------------------------------
// Unified list pane header — Zero/Cloudflare composition
// ---------------------------------------------------------------------------

/** Keeps Garden's notification bulk menu around the copied unified controls. */
function InboxListHeader({
  unreadCount,
  compact,
  scope,
  search,
  searchExpanded,
  onSearchChange,
  unreadsOnly,
  onUnreadsOnlyChange,
  onScopeChange,
  onSearchExpandedChange,
  gmailImportController,
  onCompose,
  onMarkAllRead,
  onArchiveAll,
  onArchiveAllRead,
  onArchiveCompleted,
  canCollapse,
  onCollapse,
}: {
  unreadCount: number
  compact: boolean
  scope: MailScope
  search: string
  searchExpanded: boolean
  onSearchChange: (value: string) => void
  unreadsOnly: boolean
  onUnreadsOnlyChange: (value: boolean) => void
  onScopeChange: (scope: MailScope) => void
  onSearchExpandedChange: (expanded: boolean) => void
  gmailImportController: GmailImportController
  onCompose?: () => void
  onMarkAllRead: () => void
  onArchiveAll: () => void
  onArchiveAllRead: () => void
  onArchiveCompleted: () => void
  canCollapse: boolean
  onCollapse: () => void
}) {
  return (
    <div className="shrink-0">
      <div className="flex h-11 w-full items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {compact && canCollapse ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse conversation list"
              title="Collapse conversation list"
              onClick={onCollapse}
            >
              <PanelLeftClose />
            </Button>
          ) : (
            <h1 className="text-base font-medium text-foreground">Inbox</h1>
          )}
          {!compact && unreadCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {canCollapse && !compact ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse conversation list"
              title="Collapse conversation list"
              onClick={onCollapse}
            >
              <PanelLeftClose />
            </Button>
          ) : null}
          <GmailImportControl
            controller={gmailImportController}
            compact={compact}
          />
          {onCompose ? (
            <Button
              size={compact ? 'icon-sm' : 'sm'}
              aria-label="Compose"
              title={compact ? 'Compose' : undefined}
              onClick={onCompose}
            >
              <SquarePen />
              {!compact ? 'Compose' : null}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={onMarkAllRead}>
                <CheckCheck className="h-4 w-4" />
                Mark all as read
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onArchiveAll}>
                <Archive className="h-4 w-4" />
                Archive all
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchiveAllRead}>
                <BookCheck className="h-4 w-4" />
                Archive all read
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchiveCompleted}>
                <ListChecks className="h-4 w-4" />
                Archive completed
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <MailListToolbar
        scope={scope}
        search={search}
        unreadOnly={unreadsOnly}
        selectedCount={0}
        compact={compact}
        searchExpanded={searchExpanded}
        onScopeChange={onScopeChange}
        onSearchChange={onSearchChange}
        onUnreadOnlyChange={onUnreadsOnlyChange}
        onSearchExpandedChange={onSearchExpandedChange}
        onClearSelection={() => undefined}
      />
    </div>
  )
}

function focusForInboxItem(item: InboxItem): string | null {
  const details = item.details ?? {}

  if (
    (item.type === 'new_comment' ||
      item.type === 'mentioned' ||
      item.type === 'reaction_added') &&
    details.comment_id
  ) {
    return `comment:${details.comment_id}`
  }

  if (item.type === 'waiting_for_input') {
    return `question:${details.run_id ?? item.issue_id ?? item.id}`
  }

  if (item.type === 'wp_review') {
    return `wp_review:${details.work_product_id ?? item.id}`
  }

  if (item.type === 'review_requested') {
    return `approval:${details.approval_id ?? details.request_id ?? details.run_id ?? item.issue_id ?? item.id}`
  }

  if (item.type === 'task_failed') {
    return `failed_run:${details.run_id ?? item.issue_id ?? item.id}`
  }

  if (item.type === 'agent_blocked') {
    return `blocked:${details.run_id ?? item.issue_id ?? item.id}`
  }

  if (item.type === 'task_completed' && details.run_id) {
    return `run:${details.run_id}`
  }

  return null
}

function InboxNotificationDetail({
  item,
  onArchive,
  onOpenIssue,
}: {
  item: InboxItem
  onArchive: () => void
  onOpenIssue: () => void
}) {
  const { getActorName } = useActorName()
  const actorName =
    getActorName(
      item.actor_type ?? item.recipient_type,
      item.actor_id ?? item.recipient_id,
    ) || typeLabels[item.type]
  const issueNumber = item.details?.issue_number
  const cta = ctaForInboxItem(item)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="shrink-0 border-b px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!item.read && (
                <span className="size-1.5 rounded-full bg-brand" />
              )}
              <span>{typeLabels[item.type]}</span>
              <span>·</span>
              <span>{timeAgo(item.created_at)}</span>
              {issueNumber && (
                <>
                  <span>·</span>
                  <span className="font-mono">#{issueNumber}</span>
                </>
              )}
            </div>
            <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {item.title}
            </h2>
            <p className="text-sm text-muted-foreground">{actorName}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onArchive}>
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            Archive
          </Button>
        </div>
      </div>

      <div className="w-full max-w-3xl space-y-5 p-6">
        <InboxItemPreviewCard item={item} />
        <InboxControlPlane item={item} />
        {item.issue_id && (
          <Button size="sm" onClick={onOpenIssue}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {cta}
          </Button>
        )}
      </div>
    </div>
  )
}

const MAIL_SELECTION_PREFIX = 'mail:'
const COMPACT_INBOX_WIDTH = 768

function mailSelectionKey(conversationId: string): string {
  return `${MAIL_SELECTION_PREFIX}${conversationId}`
}

function selectedMailId(selectedKey: string): string | null {
  return selectedKey.startsWith(MAIL_SELECTION_PREFIX)
    ? selectedKey.slice(MAIL_SELECTION_PREFIX.length)
    : null
}

/** Search semantics shared by Mail and All scopes at the adapter boundary. */
export function mailConversationMatches(
  conversation: MailConversationSummaryView,
  search: string,
  unreadOnly: boolean,
): boolean {
  if (unreadOnly && !conversation.unread) return false
  const query = search.trim().toLowerCase()
  if (!query) return true
  return [
    conversation.subject,
    conversation.snippet,
    ...conversation.participants.flatMap((participant) => [
      participant.name ?? '',
      participant.address,
    ]),
    ...(conversation.labels?.map((label) => label.name) ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

/**
 * Observes the actual dock pane instead of the viewport. Both reference apps
 * own their full page; Garden must apply their 768px state switch per pane.
 */
function useCompactInboxPane(): {
  ref: (node: HTMLDivElement | null) => void
  compact: boolean
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!element || typeof ResizeObserver === 'undefined')
        return () => undefined
      const observer = new ResizeObserver(onStoreChange)
      observer.observe(element)
      return () => observer.disconnect()
    },
    [element],
  )
  const readWidth = useCallback(
    () => (element?.clientWidth ?? 0) < COMPACT_INBOX_WIDTH,
    [element],
  )
  const compact = useSyncExternalStore(subscribe, readWidth, () => true)
  return { ref: setElement, compact }
}

/** Maps the active adapter's detail state into the pinned thread UI. */
function MailDetailSurface({
  controller,
  workspaceId,
  conversationId,
  compact,
  onClose,
  agentPanel,
  onToggleAgent,
}: {
  controller: ActiveMailInboxController
  workspaceId: string
  conversationId: string
  compact: boolean
  onClose: () => void
  agentPanel: { agentId: string; open: boolean } | null
  onToggleAgent: (agentId: string) => void
}) {
  const queryClient = useQueryClient()
  const ownerUserId = useAuthStore((state) => state.user?.id ?? null)
  const [expansion, setExpansion] = useState<{
    conversationId: string
    expandedIds: ReadonlySet<string>
  } | null>(null)
  const eligibleAgentsQuery = useQuery(
    eligibleMailAgentsOptions({ workspaceId, conversationId }),
  )
  const detail = controller.detail

  if (detail.status === 'loading' || detail.status === 'idle') {
    return <MailDetailSkeleton />
  }
  if (detail.status === 'error') {
    return (
      <MailErrorState
        title="Conversation could not be loaded"
        description={detail.message}
        onRetry={detail.retry}
      />
    )
  }
  if (detail.conversation.id !== conversationId) return <MailDetailSkeleton />

  const conversation: MailConversationView = detail.conversation
  const selectedAgentId =
    agentPanel &&
    eligibleAgentsQuery.data?.some((agent) => agent.id === agentPanel.agentId)
      ? agentPanel.agentId
      : (conversation.agentAssignments[0]?.agentId ??
        eligibleAgentsQuery.data?.[0]?.id ??
        null)
  const selectedAgent = eligibleAgentsQuery.data?.find(
    (agent) => agent.id === selectedAgentId,
  )
  const agentPanelOpen =
    agentPanel?.open === true &&
    agentPanel.agentId === selectedAgent?.id &&
    selectedAgent !== undefined

  const newestMessageId = conversation.messages.at(-1)?.id
  const expandedMessageIds =
    expansion?.conversationId === conversation.id
      ? expansion.expandedIds
      : new Set(newestMessageId ? [newestMessageId] : [])

  const toggleMessage = (messageId: string) => {
    setExpansion((current) => {
      const next = new Set(
        current?.conversationId === conversation.id
          ? current.expandedIds
          : newestMessageId
            ? [newestMessageId]
            : [],
      )
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return { conversationId: conversation.id, expandedIds: next }
    })
  }

  const inlineComposer =
    controller.composer?.replyToMessageId === undefined ? null : (
      <MailComposer variant="inline" {...controller.composer.props} />
    )

  const toolbar = (
    <MailDetailToolbar
      compact={compact}
      starred={conversation.starred}
      unread={conversation.unread}
      folders={controller.folders}
      onBack={onClose}
      onClose={onClose}
      onReplyAll={
        conversation.canSend
          ? () => controller.actions.replyAll(conversation.id)
          : undefined
      }
      onToggleStar={() => controller.actions.toggleStar(conversation.id)}
      onToggleRead={() => controller.actions.toggleRead(conversation.id)}
      onArchive={() => {
        controller.actions.archive(conversation.id)
        onClose()
      }}
      onViewSource={() => controller.actions.viewSource(conversation.id)}
      agentControl={
        <Button
          variant={agentPanelOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          disabled={!selectedAgent}
          aria-label={agentPanelOpen ? 'Close agent' : 'Open agent'}
          title={
            selectedAgent
              ? agentPanelOpen
                ? 'Close agent'
                : 'Open agent'
              : 'No mailbox agent available'
          }
          onClick={() => {
            if (!selectedAgent) return
            onToggleAgent(selectedAgent.id)
          }}
          onPointerEnter={() => {
            if (!selectedAgent) return
            void queryClient.prefetchQuery(
              mailAgentSessionOptions({
                workspaceId,
                agentId: selectedAgent.id,
                ownerUserId,
              }),
            )
          }}
          onFocus={() => {
            if (!selectedAgent) return
            void queryClient.prefetchQuery(
              mailAgentSessionOptions({
                workspaceId,
                agentId: selectedAgent.id,
                ownerUserId,
              }),
            )
          }}
        >
          <Bot />
        </Button>
      }
    />
  )

  return (
    <MailConversationDetail
      conversation={conversation}
      toolbar={toolbar}
      expandedMessageIds={expandedMessageIds}
      replyingToMessageId={controller.composer?.replyToMessageId}
      inlineComposer={inlineComposer}
      onToggleMessage={toggleMessage}
      messageActions={(message) =>
        controller.actions.messageProps(conversation.id, message)
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Composes notifications and adapter-backed mail inside Garden's dock panel.
 * Mail remains an explicit unavailable state until its authenticated API ships.
 */
export function InboxPage({
  mailController: suppliedMailController,
  gmailImportController = unavailableGmailImportController,
}: {
  mailController?: MailInboxController
  gmailImportController?: GmailImportController
} = {}) {
  const wsId = useWorkspaceId()
  const { searchParams, replace } = useNavigation()
  const dock = useWorkspaceDock()
  const selectedKey = searchParams.get('item') ?? ''
  const mailConversationId = selectedMailId(selectedKey)

  const [search, setSearch] = useState('')
  const [unreadsOnly, setUnreadsOnly] = useState(false)
  const [scope, setScope] = useState<MailScope>('all')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const mailAgentId = searchParams.get('mailAgent')
  const agentPanel = mailAgentId
    ? { agentId: mailAgentId, open: true as const }
    : null
  const deferredMailSearch = useDeferredValue(search)
  const { ref: paneRef, compact } = useCompactInboxPane()

  /** Keeps the independent inbox chat pane stable across URL-driven selection. */
  const setAgentPanelVisibility = useCallback(
    (next: { agentId: string; open: boolean } | null) => {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      if (next?.open) url.searchParams.set('mailAgent', next.agentId)
      else url.searchParams.delete('mailAgent')
      replace(`${url.pathname}${url.search}`)
    },
    [replace],
  )

  const setSelectedKey = useCallback(
    (key: string, item?: InboxItem | null) => {
      // Persist selection in the search params on whatever route we're on so
      // we don't trigger a TanStack Router 404 (no `/inbox` route exists —
      // the inbox is a dock panel, not a path).
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      url.searchParams.set('item', key || NO_INBOX_SELECTION)

      if (item?.issue_id) url.searchParams.set('issue', item.issue_id)
      else url.searchParams.delete('issue')

      const focus = item ? focusForInboxItem(item) : null
      if (focus) url.searchParams.set('focus', focus)
      else url.searchParams.delete('focus')
      replace(`${url.pathname}${url.search}`)
    },
    [replace],
  )

  const defaultMailController = useMailInboxController({
    workspaceId: wsId,
    selectedConversationId: mailConversationId,
    search: deferredMailSearch,
    unreadOnly: unreadsOnly,
  })
  const mailController = suppliedMailController ?? defaultMailController
  const { data: rawItems = [] } = useQuery(inboxListOptions(wsId))
  const allItems = useMemo(() => deduplicateInboxItems(rawItems), [rawItems])

  const { getActorName } = useActorName()

  const notificationItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allItems.filter((item) => {
      if (unreadsOnly && item.read) return false
      if (!query) return true
      const actor =
        getActorName(
          item.actor_type ?? item.recipient_type,
          item.actor_id ?? item.recipient_id,
        ) ?? ''
      const haystack = [
        item.title,
        item.body ?? '',
        typeLabels[item.type] ?? '',
        actor,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [allItems, search, unreadsOnly, getActorName])

  const readyMailEntries =
    mailController.status === 'active' && mailController.list.status === 'ready'
      ? mailController.list.entries
      : []
  const filteredMailEntries = readyMailEntries
  const unreadCount =
    allItems.filter((item) => !item.read).length +
    readyMailEntries.filter(({ conversation }) => conversation.unread).length

  type UnifiedInboxRow =
    | { kind: 'notification'; item: InboxItem; sortTimestamp: string }
    | {
        kind: 'mail'
        conversation: MailConversationSummaryView
        sortTimestamp: string
      }

  const unifiedRows: UnifiedInboxRow[] = [
    ...(scope === 'mail'
      ? []
      : notificationItems.map((item) => ({
          kind: 'notification' as const,
          item,
          sortTimestamp: item.created_at,
        }))),
    ...(scope === 'notifications'
      ? []
      : filteredMailEntries.map((entry) => ({
          kind: 'mail' as const,
          conversation: entry.conversation,
          sortTimestamp: entry.sortTimestamp,
        }))),
  ].sort(
    (left, right) =>
      new Date(right.sortTimestamp).getTime() -
      new Date(left.sortTimestamp).getTime(),
  )
  const firstSelectionKey =
    unifiedRows[0]?.kind === 'mail'
      ? mailSelectionKey(unifiedRows[0].conversation.id)
      : (unifiedRows[0]?.item.id ?? '')
  const waitingForAutomaticMailSelection =
    scope !== 'notifications' &&
    mailController.status === 'active' &&
    mailController.list.status === 'loading'
  const effectiveSelectedKey =
    selectedKey || (waitingForAutomaticMailSelection ? '' : firstSelectionKey)
  const effectiveMailConversationId = selectedMailId(effectiveSelectedKey)
  const selectedNotification =
    effectiveMailConversationId === null
      ? (notificationItems.find((item) => item.id === effectiveSelectedKey) ??
        allItems.find((item) => item.id === effectiveSelectedKey) ??
        null)
      : null

  const markReadMutation = useMarkInboxRead()
  const archiveMutation = useArchiveInbox()
  const markAllReadMutation = useMarkAllInboxRead()
  const archiveAllMutation = useArchiveAllInbox()
  const archiveAllReadMutation = useArchiveAllReadInbox()
  const archiveCompletedMutation = useArchiveCompletedInbox()

  // Click-to-read: select + auto-mark-read
  const handleSelect = (item: InboxItem) => {
    setSelectedKey(item.id, item)
    if (!item.read) {
      markReadMutation.mutate(item.id, {
        onError: () => toast.error('Failed to mark as read'),
      })
    }
  }

  const handleArchive = (id: string) => {
    const archived = allItems.find((i) => i.id === id)
    if (archived && archived.id === effectiveSelectedKey) setSelectedKey('')
    archiveMutation.mutate(id, {
      onError: () => toast.error('Failed to archive'),
    })
  }

  // Batch operations
  const handleMarkAllRead = () => {
    markAllReadMutation.mutate(undefined, {
      onError: () => toast.error('Failed to mark all as read'),
    })
  }

  const handleArchiveAll = () => {
    setSelectedKey('')
    archiveAllMutation.mutate(undefined, {
      onError: () => toast.error('Failed to archive all'),
    })
  }

  const handleArchiveAllRead = () => {
    const readKeys = allItems.filter((i) => i.read).map((i) => i.id)
    if (readKeys.includes(effectiveSelectedKey)) setSelectedKey('')
    archiveAllReadMutation.mutate(undefined, {
      onError: () => toast.error('Failed to archive read items'),
    })
  }

  const handleArchiveCompleted = () => {
    setSelectedKey('')
    archiveCompletedMutation.mutate(undefined, {
      onError: () => toast.error('Failed to archive completed'),
    })
  }

  const handleOpenIssue = useCallback(
    (item: InboxItem) => {
      if (!item.issue_id) return
      setSelectedKey(item.id, item)
      dock?.openPanel({
        kind: 'issue-detail',
        title: item.title,
        entityId: item.issue_id,
      })
    },
    [dock, setSelectedKey],
  )

  const handleScopeChange = (nextScope: MailScope) => {
    setScope(nextScope)
    if (nextScope === 'mail' && selectedNotification) setSelectedKey('')
    if (nextScope === 'notifications' && effectiveMailConversationId)
      setSelectedKey('')
  }

  const selectMail = (conversation: MailConversationSummaryView) => {
    setSelectedKey(mailSelectionKey(conversation.id))
    if (mailController.status === 'active' && conversation.unread) {
      mailController.actions.toggleRead(conversation.id)
    }
  }

  /** Keeps one inbox-agent pane alive while selected-email context changes. */
  const toggleMailAgent = (agentId: string) => {
    const opening = agentPanel?.agentId !== agentId || !agentPanel.open
    if (opening) setListCollapsed(true)
    setAgentPanelVisibility({ agentId, open: opening })
  }

  const renderMailRow = (conversation: MailConversationSummaryView) => {
    if (mailController.status !== 'active') return null
    return (
      <MailConversationRow
        key={conversation.id}
        conversation={conversation}
        selected={conversation.id === effectiveMailConversationId}
        onOpen={() => selectMail(conversation)}
        onToggleStar={() => mailController.actions.toggleStar(conversation.id)}
        onToggleRead={() => mailController.actions.toggleRead(conversation.id)}
        onArchive={() => {
          if (conversation.id === effectiveMailConversationId)
            setSelectedKey('')
          mailController.actions.archive(conversation.id)
        }}
      />
    )
  }

  const panelComposer =
    mailController.status === 'active' &&
    mailController.composer &&
    mailController.composer.replyToMessageId === undefined
      ? mailController.composer
      : null
  const detailOpen = Boolean(
    panelComposer || selectedNotification || effectiveMailConversationId,
  )

  // -- Shared sub-components --------------------------------------------------

  const listHeader = (
    <InboxListHeader
      unreadCount={unreadCount}
      compact={compact || detailOpen}
      scope={scope}
      search={search}
      searchExpanded={searchExpanded}
      onSearchChange={setSearch}
      unreadsOnly={unreadsOnly}
      onUnreadsOnlyChange={setUnreadsOnly}
      onScopeChange={handleScopeChange}
      onSearchExpandedChange={setSearchExpanded}
      gmailImportController={gmailImportController}
      onCompose={
        mailController.status === 'active' && mailController.canCompose
          ? mailController.actions.openComposer
          : undefined
      }
      onMarkAllRead={handleMarkAllRead}
      onArchiveAll={handleArchiveAll}
      onArchiveAllRead={handleArchiveAllRead}
      onArchiveCompleted={handleArchiveCompleted}
      canCollapse={detailOpen && !compact}
      onCollapse={() => setListCollapsed(true)}
    />
  )

  let listBody: ReactNode
  if (scope === 'mail' && mailController.status === 'unavailable') {
    listBody = (
      <MailEmptyState
        title="Mail isn't available yet"
        description="This workspace does not have a web-connected mailbox yet. Notifications still work in All and Notifications."
      />
    )
  } else if (scope === 'mail' && mailController.status === 'active') {
    const list = mailController.list
    listBody = (
      <MailConversationList
        state={list.status}
        conversations={filteredMailEntries.map((entry) => entry.conversation)}
        renderConversation={renderMailRow}
        error={list.status === 'error' ? list.message : undefined}
        filtered={Boolean(search || unreadsOnly)}
        refreshing={list.status === 'ready' && list.refreshing}
        loadingMore={list.status === 'ready' && list.loadingMore}
        hasMore={list.status === 'ready' && list.hasMore}
        onLoadMore={list.status === 'ready' ? list.loadMore : undefined}
        onRetry={list.status === 'error' ? list.retry : undefined}
      />
    )
  } else if (
    scope === 'all' &&
    mailController.status === 'active' &&
    mailController.list.status === 'loading'
  ) {
    listBody = (
      <MailConversationList
        state="loading"
        conversations={[]}
        renderConversation={renderMailRow}
      />
    )
  } else if (unifiedRows.length === 0) {
    listBody = (
      <MailEmptyState
        title={
          allItems.length === 0 && readyMailEntries.length === 0
            ? 'Your inbox is clear'
            : 'Nothing matches'
        }
        description={
          unreadsOnly
            ? 'No unread items. Turn Unread off to see everything.'
            : search
              ? 'No inbox items match that search. Try a different query.'
              : 'Notifications and mail will appear here as work happens.'
        }
      />
    )
  } else {
    listBody = (
      <div className="py-1">
        {unifiedRows.map((row) =>
          row.kind === 'mail' ? (
            renderMailRow(row.conversation)
          ) : (
            <InboxListItem
              key={`notification:${row.item.id}`}
              item={row.item}
              isSelected={row.item.id === effectiveSelectedKey}
              onClick={() => handleSelect(row.item)}
              onArchive={() => handleArchive(row.item.id)}
            />
          ),
        )}
      </div>
    )
  }

  let detailContent: ReactNode = null
  if (panelComposer) {
    detailContent = <MailComposer variant="panel" {...panelComposer.props} />
  } else if (selectedNotification) {
    const notificationDetail = (
      <InboxNotificationDetail
        item={selectedNotification}
        onArchive={() => handleArchive(selectedNotification.id)}
        onOpenIssue={() => handleOpenIssue(selectedNotification)}
      />
    )
    detailContent = compact ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedKey('')}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
            Inbox
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {notificationDetail}
        </div>
      </div>
    ) : (
      notificationDetail
    )
  } else if (
    effectiveMailConversationId &&
    mailController.status === 'active'
  ) {
    detailContent = (
      <MailDetailSurface
        controller={mailController}
        workspaceId={wsId}
        conversationId={effectiveMailConversationId}
        compact={compact}
        onClose={() => setSelectedKey('')}
        agentPanel={agentPanel}
        onToggleAgent={toggleMailAgent}
      />
    )
  } else if (effectiveMailConversationId) {
    detailContent = (
      <MailErrorState
        title="Mail isn't available"
        description="Garden cannot load this conversation until the authenticated mailbox API is connected."
      />
    )
  }

  return (
    <div ref={paneRef} className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        <MailSplitView
          compact={compact}
          detailOpen={detailOpen}
          listCollapsed={listCollapsed}
          onExpandList={() => setListCollapsed(false)}
          list={
            <div className="flex h-full min-h-0 flex-col">
              {listHeader}
              <div
                className="min-h-0 flex-1 overflow-y-auto"
                onScroll={(event) => {
                  if (
                    mailController.status !== 'active' ||
                    mailController.list.status !== 'ready' ||
                    !mailController.list.hasMore ||
                    mailController.list.loadingMore
                  ) {
                    return
                  }
                  const viewport = event.currentTarget
                  if (
                    viewport.scrollHeight -
                      viewport.scrollTop -
                      viewport.clientHeight <
                    320
                  ) {
                    mailController.list.loadMore?.()
                  }
                }}
              >
                {listBody}
              </div>
            </div>
          }
          detail={detailContent ?? <MailNoSelectionState />}
        />
      </div>
      {agentPanel?.open ? (
        <MailAgentPane>
          <MailAgentConversationPanel
            workspaceId={wsId}
            conversationId={effectiveMailConversationId}
            agentId={agentPanel.agentId}
            onClose={() => setAgentPanelVisibility(null)}
            onOpenDraft={
              mailController.status === 'active'
                ? mailController.actions.openAgentDraft
                : undefined
            }
          />
        </MailAgentPane>
      ) : null}
    </div>
  )
}
