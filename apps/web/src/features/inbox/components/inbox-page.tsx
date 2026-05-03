'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  inboxListOptions,
  deduplicateInboxItems,
} from '@/lib/inbox/queries'
import {
  useMarkInboxRead,
  useArchiveInbox,
  useMarkAllInboxRead,
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
} from '@/lib/inbox/mutations'
import { useActorName } from '@/lib/workspace/hooks'
import { IssueDetail } from '../../issues/components'
import { useNavigation } from '../../navigation'
import { toast } from 'sonner'
import {
  MoreHorizontal,
  Inbox,
  CheckCheck,
  Archive,
  BookCheck,
  ListChecks,
  ArrowLeft,
} from 'lucide-react'
import type { InboxItem } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@garden/ui/components/ui/resizable'
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

function InboxEmptyState({
  title,
  body,
}: {
  title: string
  body: string
}) {
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function InboxPage() {
  const { searchParams, replace } = useNavigation()
  const urlIssue = searchParams.get('issue') ?? ''

  const [selectedKey, setSelectedKeyState] = useState(() => urlIssue)
  const [search, setSearch] = useState('')
  const [unreadsOnly, setUnreadsOnly] = useState(false)

  // Sync from URL when searchParams change (e.g. navigation)
  useEffect(() => {
    setSelectedKeyState(urlIssue)
  }, [urlIssue])

  const setSelectedKey = useCallback(
    (key: string) => {
      setSelectedKeyState(key)
      const url = key ? `/inbox?issue=${key}` : '/inbox'
      replace(url)
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

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'accelerate_inbox_layout',
  })

  const isMobile = useIsMobile()
  const selected =
    items.find((i) => (i.issue_id ?? i.id) === selectedKey) ??
    allItems.find((i) => (i.issue_id ?? i.id) === selectedKey) ??
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
    setSelectedKey(item.issue_id ?? item.id)
    if (!item.read) {
      markReadMutation.mutate(item.id, {
        onError: () => toast.error('Failed to mark as read'),
      })
    }
  }

  const handleArchive = (id: string) => {
    const archived = allItems.find((i) => i.id === id)
    if (archived && (archived.issue_id ?? archived.id) === selectedKey)
      setSelectedKey('')
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
    const readKeys = allItems
      .filter((i) => i.read)
      .map((i) => i.issue_id ?? i.id)
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
            isSelected={(item.issue_id ?? item.id) === selectedKey}
            onClick={() => handleSelect(item)}
            onArchive={() => handleArchive(item.id)}
          />
        ))}
      </div>
    )

  const detailContent = selected?.issue_id ? (
    <IssueDetail
      key={selected.id}
      issueId={selected.issue_id}
      defaultSidebarOpen={false}
      layoutId="accelerate_inbox_issue_detail_layout"
      highlightCommentId={selected.details?.comment_id ?? undefined}
      onDelete={() => {
        handleArchive(selected.id)
      }}
    />
  ) : selected ? (
    <div className="p-6">
      <h2 className="text-lg font-semibold">{selected.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {typeLabels[selected.type]} · {timeAgo(selected.created_at)}
      </p>
      {selected.body && (
        <div className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
          {selected.body}
        </div>
      )}
      <div className="mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleArchive(selected.id)}
        >
          <Archive className="mr-1.5 h-3.5 w-3.5" />
          Archive
        </Button>
      </div>
    </div>
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

  // -- Desktop layout: resizable two-panel -----------------------------------

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="flex-1 min-h-0"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="list"
        defaultSize={320}
        minSize={280}
        maxSize={480}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div className="flex h-full flex-col border-r">
          {listHeader}
          <div className="flex-1 min-h-0 overflow-y-auto">{listBody}</div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="detail" minSize="40%">
        <div className="flex h-full min-h-0 flex-col">{detailContent}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
