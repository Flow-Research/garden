'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { useDefaultLayout } from 'react-resizable-panels'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  inboxListOptions,
  deduplicateInboxItems,
} from '@garden/core/inbox/queries'
import {
  useMarkInboxRead,
  useArchiveInbox,
  useMarkAllInboxRead,
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
} from '@garden/core/inbox/mutations'
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
import { PageHeader } from '../../layout/page-header'
import { InboxListItem, timeAgo } from './inbox-list-item'
import { typeLabels } from './inbox-detail-label'

const INBOX_PAGE_MOBILE_SKELETON = 'inbox-page-mobile'
const INBOX_PAGE_DESKTOP_SKELETON = 'inbox-page-desktop'

function InboxPageListFixture() {
  return (
    <div>
      {[
        ['Agent reply needs review', 'Comment', '2m'],
        ['Slack connector needs re-auth', 'Connection', '9m'],
        ['Blocked issue needs input', 'Issue', '21m'],
        ['New task completed', 'Activity', '1h'],
      ].map(([title, type, when]) => (
        <div
          key={title}
          className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
        >
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-foreground">
            {type.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">
              {type} · {when}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function InboxPageMobileFixture() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="justify-between">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <div className="rounded-md bg-accent px-2 py-1 text-xs text-muted-foreground">
          4
        </div>
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <InboxPageListFixture />
      </div>
    </div>
  )
}

function InboxPageDesktopFixture() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
      <ResizablePanel
        id="list-fixture"
        defaultSize={320}
        minSize={240}
        maxSize={480}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div className="flex h-full flex-col border-r">
          <PageHeader className="justify-between">
            <h1 className="text-sm font-semibold">Inbox</h1>
            <div className="rounded-md bg-accent px-2 py-1 text-xs text-muted-foreground">
              4
            </div>
          </PageHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <InboxPageListFixture />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="detail-fixture" minSize="40%">
        <div className="flex h-full flex-col p-6">
          <h2 className="text-lg font-semibold">Agent reply needs review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Comment · 2m ago
          </p>
          <div className="mt-4 space-y-3 text-sm text-foreground/80">
            <p>
              The agent finished triage and needs a human to confirm the next
              step.
            </p>
            <p>Open the issue detail to review the conversation and respond.</p>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export function InboxPageMobileSkeleton() {
  const fixture = <InboxPageMobileFixture />

  return (
    <BoneyardSkeleton
      name={INBOX_PAGE_MOBILE_SKELETON}
      loading
      fixture={fixture}
      className="flex flex-1 min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function InboxPageDesktopSkeleton() {
  const fixture = <InboxPageDesktopFixture />

  return (
    <BoneyardSkeleton
      name={INBOX_PAGE_DESKTOP_SKELETON}
      loading
      fixture={fixture}
      className="flex flex-1 min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function InboxPage() {
  const { searchParams, replace } = useNavigation()
  const urlIssue = searchParams.get('issue') ?? ''

  const [selectedKey, setSelectedKeyState] = useState(() => urlIssue)

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
  const { data: rawItems = [], isLoading: loading } = useQuery(
    inboxListOptions(wsId),
  )
  const items = useMemo(() => deduplicateInboxItems(rawItems), [rawItems])

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'accelerate_inbox_layout',
  })

  const isMobile = useIsMobile()
  const selected =
    items.find((i) => (i.issue_id ?? i.id) === selectedKey) ?? null
  const unreadCount = items.filter((i) => !i.read).length

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
    const archived = items.find((i) => i.id === id)
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
    const readKeys = items.filter((i) => i.read).map((i) => i.issue_id ?? i.id)
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
    <PageHeader className="justify-between">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold">Inbox</h1>
        {unreadCount > 0 && (
          <span className="text-xs text-muted-foreground">{unreadCount}</span>
        )}
      </div>
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
          <DropdownMenuItem onClick={handleMarkAllRead}>
            <CheckCheck className="h-4 w-4" />
            Mark all as read
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleArchiveAll}>
            <Archive className="h-4 w-4" />
            Archive all
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleArchiveAllRead}>
            <BookCheck className="h-4 w-4" />
            Archive all read
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleArchiveCompleted}>
            <ListChecks className="h-4 w-4" />
            Archive completed
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PageHeader>
  )

  const listBody =
    items.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Inbox className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm">No notifications</p>
      </div>
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
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
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
    // Mobile: show detail full-screen when an item is selected
    return (
      <BoneyardSkeleton
        name={INBOX_PAGE_MOBILE_SKELETON}
        loading={loading}
        className="flex flex-1 min-h-0"
      >
        {!loading ? (
          selected ? (
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
        ) : null}
      </BoneyardSkeleton>
    )
  }

  // -- Desktop layout: resizable two-panel -----------------------------------

  return (
    <BoneyardSkeleton
      name={INBOX_PAGE_DESKTOP_SKELETON}
      loading={loading}
      className="flex flex-1 min-h-0"
    >
      {!loading ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="flex-1 min-h-0"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel
            id="list"
            defaultSize={320}
            minSize={240}
            maxSize={480}
            groupResizeBehavior="preserve-pixel-size"
          >
            <div className="flex flex-col border-r h-full">
              {listHeader}
              <div className="flex-1 min-h-0 overflow-y-auto">{listBody}</div>
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="detail" minSize="40%">
            <div className="flex flex-col min-h-0 h-full">
              {detailContent ?? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <Inbox className="mb-3 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm">
                    {items.length === 0
                      ? 'Your inbox is empty'
                      : 'Select a notification to view details'}
                  </p>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : null}
    </BoneyardSkeleton>
  )
}
