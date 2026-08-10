// State hierarchy adapted from Zero (MIT) and Cloudflare Agentic Inbox (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { AlertCircle, Inbox, MailOpen } from 'lucide-react'

export function MailListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading conversations" className="space-y-1 p-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-24 gap-3 rounded-lg px-3 py-2">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MailDetailSkeleton() {
  return (
    <div aria-label="Loading conversation" className="h-full p-5">
      <div className="flex items-center gap-2 border-b pb-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="size-7" />
        ))}
      </div>
      <Skeleton className="mt-6 h-6 w-2/3" />
      <div className="mt-7 flex gap-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="mt-8 space-y-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  )
}

export function MailEmptyState({
  title = 'No mail here',
  description = 'Messages will appear here when they arrive.',
  action,
}: {
  title?: string
  description?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <Empty className="h-full rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

export function MailNoSelectionState() {
  return (
    <Empty className="h-full rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MailOpen />
        </EmptyMedia>
        <EmptyTitle>Select a conversation</EmptyTitle>
        <EmptyDescription>
          Choose mail from the list to read the full thread.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function MailErrorState({
  title = 'Mail could not be loaded',
  description,
  onRetry,
}: {
  title?: string
  description: string
  onRetry?: () => void
}) {
  return (
    <Empty className="h-full rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive">
          <AlertCircle />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
