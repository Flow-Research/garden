import { useState, useCallback, useMemo, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  inboxKeys,
  inboxListOptions,
  groupInboxItems,
  type InboxThread,
} from '@/lib/inbox/queries'
import { gmailListOptions } from '@/lib/gmail/queries'
import type {
  GmailDraftSummary,
  GmailEmailSummary,
  GmailView,
} from '@/lib/api/gmail-contract'
import { useMarkInboxRead, useArchiveInbox } from '@/lib/inbox/mutations'
import { api } from '@/lib/api'
import { issueKeys } from '@/lib/issues/queries'
import { useActorName } from '@/lib/workspace/hooks'
import { useNavigation } from '../../navigation'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import { toast } from 'sonner'
import { ArrowLeft, X } from 'lucide-react'
import type { InboxItem } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'

import { useIsMobile } from '@garden/ui/hooks/use-mobile'
import { InboxListItemV2 } from './inbox-list-item'
import { typeLabels } from './inbox-detail-label'
import {
  InboxListHeaderV2,
  type InboxFilter,
} from './inbox-headers/inbox-header-v2'
import { InboxFooter } from './inbox-footer'
import { GmailDetail, GmailErrorState, GmailListItem } from './gmail-views'
import { InboxNotificationDetailV2 } from './inbox-details/inbox-notification-detail'
import { EnvelopeOpenIcon } from '@phosphor-icons/react'

/** Subscribes to the viewport media query without leaking a render-time listener. */
function useIsDesktop(): boolean {
  const query = '(min-width: 1024px)'
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query)
      const onChange = () => onStoreChange()
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

// ---------------------------------------------------------------------------
// Empty state — centered full-pane
// ---------------------------------------------------------------------------
const InboxEmptyIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
    >
      <g>
        <g style={{ display: 'none' }}>
          <g className="fills">
            <rect
              width="32"
              height="32"
              x="0"
              transform="matrix(1.000000, 0.000000, 0.000000, 1.000000, 0.000000, 0.000000)"
              style={{ fill: 'none' }}
              ry="0"
              fill="none"
              rx="0"
              y="0"
            />
          </g>
        </g>

        <g style={{ fill: 'rgb(0, 0, 0)' }}>
          <g>
            <g className="fills">
              <path
                d="M1.171142578125,5.477294921875L30.828857421875,5.477294921875C31.4736328125,5.477294921875,31.999755859375,6.003662109375,31.999755859375,6.6484375L31.999755859375,25.3515625C31.999755859375,25.994873046875,31.4736328125,26.522705078125,30.828857421875,26.522705078125L1.171142578125,26.522705078125C0.5263671875,26.522705078125,0.000244140625,25.994873046875,0.000244140625,25.3515625L0.000244140625,6.6484375C0.000244140625,6.003662109375,0.5263671875,5.477294921875,1.171142578125,5.477294921875Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 178, 41)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M1.171142578125,5.477294921875L30.828857421875,5.477294921875C31.4736328125,5.477294921875,31.999755859375,6.003662109375,31.999755859375,6.6484375L31.999755859375,9.413818359375L18.804443359375,18.775390625C17.103759765625,19.981689453125,14.896240234375,19.981689453125,13.195556640625,18.775390625L0.000244140625,9.413818359375L0.000244140625,6.6484375C0.000244140625,6.003662109375,0.5263671875,5.477294921875,1.171142578125,5.477294921875Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(230, 160, 37)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M0.000244140625,24.510009765625L11.99609375,15.9990234375L0.000244140625,7.48828125Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 152, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M31.999755859375,24.510009765625L20.00390625,15.9990234375L31.999755859375,7.48828125Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 152, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M21.361083984375,16.961181640625L20.00390625,15.9990234375L31.999755859375,7.48828125L31.999755859375,9.413818359375Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(230, 137, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M1.171142578125,5.477294921875L30.828857421875,5.477294921875C31.4736328125,5.477294921875,31.999755859375,6.003662109375,31.999755859375,6.6484375L31.999755859375,7.48828125L17.895751953125,17.494384765625C16.740478515625,18.314697265625,15.259521484375,18.314697265625,14.1044921875,17.494384765625L0.000244140625,7.48828125L0.000244140625,6.6484375C0.000244140625,6.003662109375,0.5263671875,5.477294921875,1.171142578125,5.477294921875Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 213, 79)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M10.640869140625,16.961181640625L11.99609375,15.9990234375L0.000244140625,7.48828125L0.000244140625,9.413818359375Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(230, 137, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M1.171142578125,5.477294921875L30.828857421875,5.477294921875C31.473876953125,5.477294921875,32,6.003662109375,32,6.648193359375L32,25.351806640625C32,25.9951171875,31.473876953125,26.522705078125,30.828857421875,26.522705078125L1.171142578125,26.522705078125C0.526123046875,26.522705078125,0,25.9951171875,0,25.351806640625L0,6.648193359375C0,6.003662109375,0.526123046875,5.477294921875,1.171142578125,5.477294921875Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 178, 41)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M1.171142578125,5.477294921875L30.828857421875,5.477294921875C31.473876953125,5.477294921875,32,6.003662109375,32,6.648193359375L32,9.413818359375L18.804443359375,18.775390625C17.103759765625,19.981689453125,14.896240234375,19.981689453125,13.195556640625,18.775390625L0,9.413818359375L0,6.648193359375C0,6.003662109375,0.526123046875,5.477294921875,1.171142578125,5.477294921875Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(230, 160, 37)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M0,24.510498046875L11.99609375,15.9990234375L0,7.48828125Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 152, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M32,24.510498046875L20.00390625,15.9990234375L32,7.48828125Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 152, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M21.361083984375,16.961181640625L20.00390625,15.9990234375L32,7.48828125L32,9.413818359375Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(230, 137, 0)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M1.171142578125,5.477294921875L30.828857421875,5.477294921875C31.473876953125,5.477294921875,32,6.003662109375,32,6.648193359375L32,7.488037109375L17.895751953125,17.494384765625C16.740478515625,18.314697265625,15.259521484375,18.314697265625,14.104248046875,17.494384765625L0,7.48828125L0,6.648193359375C0,6.003662109375,0.526123046875,5.477294921875,1.171142578125,5.477294921875Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(255, 213, 79)' }}
              />
            </g>
          </g>

          <g>
            <g className="fills">
              <path
                d="M10.640625,16.961181640625L11.99609375,15.9990234375L0,7.48828125L0,9.413818359375Z"
                fillRule="evenodd"
                clipRule="evenodd"
                style={{ fill: 'rgb(230, 137, 0)' }}
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  )
}

function InboxEmptyState({
  title,
  body,
  icon,
}: {
  title: string
  body: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        {icon ? (
          <div className="flex h-14 w-14 items-center justify-center">
            {icon}
          </div>
        ) : (
          <InboxEmptyIcon />
        )}

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

function gmailViewForMode(mode: InboxFilter): GmailView | null {
  if (mode === 'In draft') return 'drafts'
  if (mode === 'Sent') return 'sent'
  return null
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

// -------------------------
// Page
// ------------------------

export function InboxPage() {
  const { searchParams, replace } = useNavigation()
  const { openIssue } = useSurfaceNavigation()
  const selectedKey = searchParams.get('item') ?? ''

  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<InboxFilter>('All')
  const [composeOpen, setComposeOpen] = useState(false)
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null)
  const [moreItems, setMoreItems] = useState<
    readonly (GmailEmailSummary | GmailDraftSummary)[]
  >([])
  const [moreCursor, setMoreCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const unreadsOnly = mode === 'Unread'
  const gmailView = gmailViewForMode(mode)

  const setSelectedKey = useCallback(
    (key: string, item?: InboxItem | null) => {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      if (key) url.searchParams.set('item', key)
      else url.searchParams.delete('item')

      if (item?.issue_id) url.searchParams.set('issue', item.issue_id)
      else url.searchParams.delete('issue')

      const focus = item ? focusForInboxItem(item) : null
      if (focus) url.searchParams.set('focus', focus)
      else url.searchParams.delete('focus')
      replace(`${url.pathname}${url.search}`)
    },
    [replace],
  )

  const wsId = useWorkspaceId()
  const { data: queryItems = [] } = useQuery(inboxListOptions(wsId))
  const gmailQuery = useQuery(gmailListOptions(wsId, gmailView))
  const allThreads = useMemo(() => groupInboxItems(queryItems), [queryItems])

  const { getActorName } = useActorName()

  const items = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allThreads.filter((thread) => {
      if (unreadsOnly && thread.read) return false
      if (!query) return true
      const haystack = thread.items
        .flatMap((item) => [
          item.title,
          item.body ?? '',
          typeLabels[item.type] ?? '',
          getActorName(
            item.actor_type ?? item.recipient_type,
            item.actor_id ?? item.recipient_id,
          ) ?? '',
        ])
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [allThreads, search, unreadsOnly, getActorName])

  const isMobile = useIsMobile()
  const isDesktop = useIsDesktop()

  const showDetailAsOverlay = !isDesktop

  const selectedThread =
    items.find((thread) => thread.id === selectedKey) ??
    allThreads.find((thread) => thread.id === selectedKey) ??
    allThreads.find((thread) =>
      thread.items.some((item) => item.id === selectedKey),
    ) ??
    null
  const selected = selectedThread?.summary ?? null
  const unreadCount = allThreads.filter((thread) => !thread.read).length

  const gmailItems = useMemo(() => {
    const seen = new Set<string>()
    const rows = [...(gmailQuery.data?.items ?? []), ...moreItems].filter(
      (item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      },
    )
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((item) =>
      [item.subject, item.snippet, item.from, item.to]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [gmailQuery.data, moreItems, search])

  const activeCursor =
    moreItems.length > 0 ? moreCursor : (gmailQuery.data?.nextCursor ?? null)

  const selectedGmail =
    gmailView !== null
      ? (gmailItems.find((item) => item.id === selectedKey) ?? null)
      : null
  const hasSelection = selected !== null || selectedGmail !== null

  const handleModeChange = (next: InboxFilter) => {
    setMode(next)
    setMoreItems([])
    setMoreCursor(null)
    setLoadingMore(false)
    setSelectedKey('')
  }

  const handleLoadMore = () => {
    if (!gmailView || loadingMore || !activeCursor) return
    setLoadingMore(true)
    api
      .listGmail(gmailView, activeCursor)
      .then((page) => {
        setMoreItems((current) => [...current, ...page.items])
        setMoreCursor(page.nextCursor)
        setLoadingMore(false)
      })
      .catch((error: unknown) => {
        setLoadingMore(false)
        toast.error(
          error instanceof Error ? error.message : 'Could not load more email.',
        )
      })
  }

  const openComposer = (draftId: string | null) => {
    setEditingDraftId(draftId)
    setComposeOpen(true)
  }

  const handleComposeOpenChange = (open: boolean) => {
    setComposeOpen(open)
    if (!open) setEditingDraftId(null)
  }

  const footer = (
    <InboxFooter
      composeOpen={composeOpen}
      onComposeOpenChange={handleComposeOpenChange}
      draftId={editingDraftId}
      onNewEmail={() => openComposer(null)}
    />
  )

  const markReadMutation = useMarkInboxRead()
  const archiveMutation = useArchiveInbox()
  const queryClient = useQueryClient()
  const replyMutation = useMutation({
    mutationFn: ({ issueId, content }: { issueId: string; content: string }) =>
      api.createComment(issueId, content),
    onSuccess: (_comment, variables) => {
      queryClient.invalidateQueries({
        queryKey: inboxKeys.list(wsId),
        exact: true,
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(wsId, variables.issueId),
        exact: true,
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.timeline(variables.issueId),
        exact: true,
      })
    },
    onError: () => toast.error('Failed to send reply'),
  })

  const handleSelect = (thread: InboxThread) => {
    setSelectedKey(thread.id, thread.latest)
    if (!thread.read) {
      markReadMutation.mutate(thread.latest.id, {
        onError: () => toast.error('Failed to mark as read'),
      })
    }
  }

  const handleArchive = (thread: InboxThread) => {
    if (thread.id === selectedThread?.id) setSelectedKey('')
    archiveMutation.mutate(thread.latest.id, {
      onError: () => toast.error('Failed to archive'),
    })
  }

  const handleOpenIssue = useCallback(
    (item: InboxItem) => {
      if (!item.issue_id) return
      setSelectedKey(item.id, item)
      openIssue(
        { id: item.issue_id, title: item.title },
        { focus: focusForInboxItem(item) },
      )
    },
    [openIssue, setSelectedKey],
  )

  const handleReply = useCallback(
    (content: string) => {
      const issueId = selected?.issue_id
      if (!issueId) return Promise.resolve(false)

      return new Promise<boolean>((resolve) => {
        replyMutation.mutate(
          { issueId, content },
          {
            onSuccess: () => resolve(true),
            onError: () => resolve(false),
          },
        )
      })
    },
    [replyMutation, selected?.issue_id],
  )

  // -- Shared sub-components --------------------------------------------------

  const listHeader = (
    <InboxListHeaderV2
      unreadCount={unreadCount}
      search={search}
      onSearchChange={setSearch}
      activeFilter={mode}
      onFilterChange={handleModeChange}
      onPrefetchFilter={(filter) => {
        const view = gmailViewForMode(filter)
        if (view) void queryClient.prefetchQuery(gmailListOptions(wsId, view))
      }}
    />
  )

  const gmailListBody = gmailQuery.isPending ? (
    <div className="flex items-center justify-center px-6 py-16 text-sm text-muted-foreground">
      Loading email...
    </div>
  ) : gmailQuery.isError ? (
    <GmailErrorState
      error={gmailQuery.error}
      onRetry={() => gmailQuery.refetch()}
    />
  ) : gmailItems.length === 0 ? (
    <InboxEmptyState
      title={mode === 'In draft' ? 'No drafts' : 'No sent messages'}
      body={
        mode === 'In draft'
          ? 'Drafts you save from the composer will appear here.'
          : 'Messages you send will appear here.'
      }
    />
  ) : (
    <>
      <div className="divide-y divide-border">
        {gmailItems.map((item) => (
          <GmailListItem
            key={item.id}
            item={item}
            badge={mode === 'In draft' ? 'Draft' : undefined}
            isSelected={item.id === selectedKey}
            onClick={() => setSelectedKey(item.id)}
          />
        ))}
      </div>
      {activeCursor ? (
        <div className="flex justify-center px-3 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={handleLoadMore}
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  )

  const listBody =
    gmailView !== null ? (
      gmailListBody
    ) : items.length === 0 ? (
      allThreads.length === 0 ? (
        <InboxEmptyState
          title="No messages"
          body="You don't have any messages in your inbox"
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
      <div className="divide-y divide-border">
        {items.map((thread) => (
          <InboxListItemV2
            key={thread.id}
            item={thread.summary}
            eventCount={thread.items.length}
            isSelected={thread.id === selectedThread?.id}
            onClick={() => handleSelect(thread)}
            onArchive={() => handleArchive(thread)}
          />
        ))}
      </div>
    )

  const detailContent =
    gmailView !== null ? (
      selectedGmail ? (
        <GmailDetail
          item={selectedGmail}
          onEditDraft={(draftId) => openComposer(draftId)}
        />
      ) : (
        <div className="flex min-h-[calc(100dvh-120px)] w-full items-center justify-center">
          <InboxEmptyState
            title="No messages"
            body="Select an email to read it here"
          />
        </div>
      )
    ) : selected ? (
      <InboxNotificationDetailV2
        item={selected}
        items={selectedThread?.items ?? [selected]}
        onArchive={() => {
          if (selectedThread) handleArchive(selectedThread)
        }}
        onOpenIssue={() => handleOpenIssue(selected)}
        onReply={handleReply}
        submittingReply={replyMutation.isPending}
      />
    ) : (
      <div className="flex min-h-[calc(100dvh-120px)] w-full items-center justify-center">
        <InboxEmptyState
          title="No messages"
          body="Once any new message is sent it'll be documented"
          icon={
            <div className="bg-muted h-20 w-20 flex items-center justify-center rounded-full text-muted-foreground shrink-0">
              <EnvelopeOpenIcon strokeWidth={0.5} size={35} />
            </div>
          }
        />
      </div>
    )

  // -- Mobile

  if (isMobile) {
    return hasSelection ? (
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
        <div className="bg-background/30 px-3 py-2">{footer}</div>
      </div>
    )
  }

  // -- Medium

  if (showDetailAsOverlay) {
    return (
      <div className="relative flex flex-1 min-h-0">
        <div className="flex min-w-0 flex-1 flex-col">
          {listHeader}
          <div className="flex-1 min-h-0 overflow-y-auto">{listBody}</div>
          <div className="bg-background/30 px-3 py-2">{footer}</div>
        </div>

        {hasSelection && (
          <>
            <button
              type="button"
              aria-label="Close detail"
              onClick={() => setSelectedKey('')}
              className="fixed inset-0 z-40 bg-black/30 animate-in fade-in-0"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Notification detail"
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-background shadow-xl animate-in slide-in-from-right duration-200"
            >
              <div className="flex h-12 shrink-0 items-center justify-end border-b px-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSelectedKey('')}
                  aria-label="Close"
                  className="text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {detailContent}
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // -- Desktop

  const listWidth = 'w-[320px]'

  return (
    <div className="flex flex-1 min-h-0">
      <div
        className={`${listWidth} shrink-0 overflow-hidden border-r transition-[width] duration-200 ease-out`}
      >
        <div className="flex h-full w-full flex-col">
          {listHeader}
          <div className="flex-1 min-h-0 overflow-y-auto">{listBody}</div>
          <div className="bg-background/30 px-3 py-2">{footer}</div>
        </div>
      </div>
      <div className="flex flex-1 min-w-0 min-h-0 flex-col">
        {detailContent}
      </div>
    </div>
  )
}
