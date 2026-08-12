// List state composition adapts Zero (MIT) and Cloudflare Agentic Inbox (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import { Spinner } from '@garden/ui/components/ui/spinner'
import type { ReactNode } from 'react'
import { MailEmptyState, MailErrorState, MailListSkeleton } from './mail-states'
import type { MailConversationSummaryView } from './types'

export type MailConversationListProps = {
  state: 'loading' | 'ready' | 'error'
  conversations: MailConversationSummaryView[]
  renderConversation: (conversation: MailConversationSummaryView) => ReactNode
  error?: string
  filtered?: boolean
  refreshing?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  onRetry?: () => void
}

/** Provides the references' explicit loading, empty, error, and refresh states. */
export function MailConversationList({
  state,
  conversations,
  renderConversation,
  error,
  filtered = false,
  refreshing = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  onRetry,
}: MailConversationListProps) {
  if (state === 'loading') return <MailListSkeleton />
  if (state === 'error') {
    return (
      <MailErrorState
        description={error || 'Check the mailbox connection and try again.'}
        onRetry={onRetry}
      />
    )
  }
  if (conversations.length === 0) {
    return (
      <MailEmptyState
        title={filtered ? 'No matching conversations' : 'No mail here'}
        description={
          filtered
            ? 'Clear or change the current search and filters.'
            : 'Messages will appear here when they arrive.'
        }
      />
    )
  }

  return (
    <div
      className="relative h-full min-h-0 overflow-y-auto py-1"
      onScroll={(event) => {
        const viewport = event.currentTarget
        if (
          hasMore &&
          !loadingMore &&
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            320
        ) {
          onLoadMore?.()
        }
      }}
    >
      {refreshing ? (
        <div
          aria-label="Refreshing conversations"
          className="sticky top-1 z-20 flex justify-center"
        >
          <span className="rounded-full border bg-background p-1 shadow-sm">
            <Spinner className="size-3.5" />
          </span>
        </div>
      ) : null}
      <div>{conversations.map(renderConversation)}</div>
      {loadingMore ? (
        <div
          aria-label="Loading more conversations"
          className="flex justify-center py-4"
        >
          <Spinner className="size-4" />
        </div>
      ) : null}
    </div>
  )
}
