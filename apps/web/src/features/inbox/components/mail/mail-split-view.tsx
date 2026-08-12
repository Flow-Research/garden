// Adapted from Cloudflare Agentic Inbox's MailboxSplitView and Zero's
// collapsible sidebar toggle (Apache-2.0 / MIT).
// See THIRD_PARTY_NOTICES.md.

import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'
import { PanelLeftOpen } from 'lucide-react'
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
  listCollapsed = false,
  onExpandList,
  className,
}: {
  compact: boolean
  detailOpen: boolean
  list: ReactNode
  detail: ReactNode
  listCollapsed?: boolean
  onExpandList?: () => void
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
            ? listCollapsed
              ? 'w-9 shrink-0 border-r'
              : 'w-[380px] shrink-0 border-r'
            : 'w-full flex-1',
          detailOpen && compact && 'hidden',
        )}
      >
        {detailOpen && !compact && listCollapsed ? (
          <div className="flex h-full justify-center pt-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Expand conversation list"
              title="Expand conversation list"
              onClick={onExpandList}
            >
              <PanelLeftOpen />
            </Button>
          </div>
        ) : (
          list
        )}
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
