'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/core/hooks'
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
  Inbox,
  CheckCheck,
  Archive,
  BookCheck,
  ListChecks,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react'
import type { InboxItem } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@garden/ui/components/ui/dropdown-menu'
import { useIsMobile } from '@garden/ui/hooks/use-mobile'
import { InboxListItem, timeAgo } from './inbox-list-item'
import { typeLabels } from './inbox-detail-label'
import { InboxItemPreviewCard, ctaForInboxItem } from './inbox-item-preview'
import { InboxControlPlane } from './inbox-control-plane'

// ---------------------------------------------------------------------------
// List pane header + search — sidebar-09 style
// ---------------------------------------------------------------------------

function InboxListHeader({
  unreadCount,
  search,
  onSearchChange,
  unreadsOnly,
  onUnreadsOnlyChange,
  onMarkAllRead,
  onArchiveAll,
  onArchiveAllRead,
  onArchiveCompleted,
}: {
  unreadCount: number
  search: string
  onSearchChange: (value: string) => void
  unreadsOnly: boolean
  onUnreadsOnlyChange: (value: boolean) => void
  onMarkAllRead: () => void
  onArchiveAll: () => void
  onArchiveAllRead: () => void
  onArchiveCompleted: () => void
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3.5 border-b p-4">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-medium text-foreground">Inbox</h1>
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span>Unreads</span>
            <Switch
              size="sm"
              checked={unreadsOnly}
              onCheckedChange={onUnreadsOnlyChange}
              className="shadow-none"
            />
          </Label>
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
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search notifications…"
        className="h-8 bg-background shadow-none"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state — centered full-pane
// ---------------------------------------------------------------------------

function InboxEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function InboxPage() {
  const { searchParams, replace } = useNavigation()
  const dock = useWorkspaceDock()
  const urlItem = searchParams.get('item') ?? ''

  const [selectedKey, setSelectedKeyState] = useState(() => urlItem)
  const [search, setSearch] = useState('')
  const [unreadsOnly, setUnreadsOnly] = useState(false)

  // Sync from URL when searchParams change (e.g. navigation)
  useEffect(() => {
    setSelectedKeyState(urlItem)
  }, [urlItem])

  const setSelectedKey = useCallback(
    (key: string, item?: InboxItem | null) => {
      setSelectedKeyState(key)
      // Persist selection in the search params on whatever route we're on so
      // we don't trigger a TanStack Router 404 (no `/inbox` route exists —
      // the inbox is a dock panel, not a path).
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        if (key) url.searchParams.set('item', key)
        else url.searchParams.delete('item')

        if (item?.issue_id) url.searchParams.set('issue', item.issue_id)
        else url.searchParams.delete('issue')

        const focus = item ? focusForInboxItem(item) : null
        if (focus) url.searchParams.set('focus', focus)
        else url.searchParams.delete('focus')
        replace(`${url.pathname}${url.search}`)
      }
    },
    [replace],
  )

  const wsId = useWorkspaceId()
  const { data: rawItems = [] } = useQuery(inboxListOptions(wsId))
  const allItems = useMemo(() => deduplicateInboxItems(rawItems), [rawItems])

  const { getActorName } = useActorName()

  const items = useMemo(() => {
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

  const isMobile = useIsMobile()
  const selected =
    items.find((i) => i.id === selectedKey) ??
    allItems.find((i) => i.id === selectedKey) ??
    null
  const unreadCount = allItems.filter((i) => !i.read).length

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
    if (archived && archived.id === selectedKey) setSelectedKey('')
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
    if (readKeys.includes(selectedKey)) setSelectedKey('')
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

  // -- Shared sub-components --------------------------------------------------

  const listHeader = (
    <InboxListHeader
      unreadCount={unreadCount}
      search={search}
      onSearchChange={setSearch}
      unreadsOnly={unreadsOnly}
      onUnreadsOnlyChange={setUnreadsOnly}
      onMarkAllRead={handleMarkAllRead}
      onArchiveAll={handleArchiveAll}
      onArchiveAllRead={handleArchiveAllRead}
      onArchiveCompleted={handleArchiveCompleted}
    />
  )

  const listBody =
    items.length === 0 ? (
      allItems.length === 0 ? (
        <InboxEmptyState
          title="Your inbox is clear"
          body="Notifications from issues, comments, and agents land here as work happens."
        />
      ) : (
        <InboxEmptyState
          title="Nothing matches"
          body={
            unreadsOnly
              ? 'No unread notifications. Toggle Unreads off to see everything.'
              : 'No notifications match that search. Try a different query.'
          }
        />
      )
    ) : (
      <div>
        {items.map((item) => (
          <InboxListItem
            key={item.id}
            item={item}
            isSelected={item.id === selectedKey}
            onClick={() => handleSelect(item)}
            onArchive={() => handleArchive(item.id)}
          />
        ))}
      </div>
    )

  const detailContent = selected ? (
    <InboxNotificationDetail
      item={selected}
      onArchive={() => handleArchive(selected.id)}
      onOpenIssue={() => handleOpenIssue(selected)}
    />
  ) : null

  // -- Mobile layout: list / detail toggle -----------------------------------

  if (isMobile) {
    return selected ? (
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex h-12 shrink-0 items-center border-b px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedKey('')}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Inbox
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{detailContent}</div>
      </div>
    ) : (
      <div className="flex flex-1 flex-col min-h-0">
        {listHeader}
        <div className="flex-1 min-h-0 overflow-y-auto">{listBody}</div>
      </div>
    )
  }

  // -- Desktop layout: list (collapsible, animated) + detail -----------------

  return (
    <div className="flex flex-1 min-h-0">
      {/* Same mechanism the explore menu uses: animate width with a CSS
          transition. `minWidth: 0` overrides the flex default that would stop
          the panel at its content's intrinsic width; `overflow-hidden` clips
          the fixed-width inner content as the outer width animates to 0. */}
      <div className="w-[320px] shrink-0 overflow-hidden border-r">
        <div className="flex h-full w-[320px] flex-col">
          {listHeader}
          <div className="flex-1 min-h-0 overflow-y-auto">{listBody}</div>
        </div>
      </div>
      <div className="flex flex-1 min-w-0 min-h-0 flex-col">
        {detailContent}
      </div>
    </div>
  )
}
