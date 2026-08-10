// Adapted from Cloudflare Agentic Inbox's MailboxSplitView (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import { cn } from '@garden/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * Dock-compatible list/detail shell. The owner derives `compact` from pane
 * width, avoiding the source apps' viewport breakpoint and nested resizers.
 */
export function MailSplitView({
  compact,
  detailOpen,
  list,
  detail,
  className,
}: {
  compact: boolean
  detailOpen: boolean
  list: ReactNode
  detail: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex h-full min-h-0 w-full overflow-hidden', className)}
    >
      <section
        aria-label="Conversations"
        className={cn(
          'h-full min-h-0 min-w-0 overflow-hidden',
          detailOpen && !compact
            ? 'w-[380px] shrink-0 border-r'
            : 'w-full flex-1',
          detailOpen && compact && 'hidden',
        )}
      >
        {list}
      </section>
      {detailOpen ? (
        <section
          aria-label="Conversation detail"
          className="h-full min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {detail}
        </section>
      ) : null}
    </div>
  )
}
