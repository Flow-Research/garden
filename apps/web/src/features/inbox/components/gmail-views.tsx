import { ApiError } from '@/lib/api'
import { executorOAuthStartUrl } from '@/lib/api/executor'
import type {
  GmailDraftSummary,
  GmailEmailSummary,
} from '@/lib/api/gmail-contract'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { CalendarDays } from 'lucide-react'

function formatGmailDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const sameDay = date.toDateString() === new Date().toDateString()
  const day = sameDay
    ? 'Today'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${day}, ${time}`
}

export function GmailListItem({
  item,
  badge,
  isSelected,
  onClick,
}: {
  item: GmailEmailSummary
  badge?: string
  isSelected: boolean
  onClick: () => void
}) {
  const initial = (item.from || item.to || '?').slice(0, 1).toUpperCase()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group relative grid min-h-20.25 w-full cursor-pointer grid-cols-[32px_minmax(0,1fr)] gap-x-3 border-b bg-background px-3 py-3 pr-10 text-left transition-colors last:border-b-0',
        isSelected ? 'border-l-2 border-l-muted bg-muted' : 'hover:bg-muted/40',
      )}
    >
      <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-muted-foreground/15 text-xs font-semibold text-muted-foreground">
        {initial}
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold leading-5 text-foreground">
            {item.from || item.to || 'Gmail'}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>

        <p className="min-w-0 truncate text-[13px] leading-5 text-muted-foreground">
          {item.subject}
        </p>
        {item.snippet ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {item.snippet}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium leading-4 text-foreground">
          <CalendarDays className="size-3.5 text-muted-foreground" />
          <span>{formatGmailDate(item.date)}</span>
        </div>
      </div>
    </div>
  )
}

export function GmailDetail({
  item,
  onEditDraft,
}: {
  item: GmailEmailSummary | GmailDraftSummary
  onEditDraft?: (draftId: string) => void
}) {
  const draftId = 'draftId' in item ? item.draftId : null
  return (
    <div className="flex min-h-0 flex-col px-5 py-4">
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {item.subject}
      </h2>
      <dl className="mt-3 space-y-1 text-[13px]">
        {item.from ? (
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-muted-foreground">
              From:
            </dt>
            <dd className="min-w-0 truncate text-foreground">{item.from}</dd>
          </div>
        ) : null}
        {item.to ? (
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-muted-foreground">To:</dt>
            <dd className="min-w-0 truncate text-foreground">{item.to}</dd>
          </div>
        ) : null}
        {item.date ? (
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-muted-foreground">
              Date:
            </dt>
            <dd className="text-foreground">{formatGmailDate(item.date)}</dd>
          </div>
        ) : null}
      </dl>
      {item.snippet ? (
        <p className="mt-4 text-sm leading-relaxed text-foreground">
          {item.snippet}
        </p>
      ) : null}
      {draftId && onEditDraft ? (
        <div className="mt-5">
          <Button type="button" onClick={() => onEditDraft(draftId)}>
            Edit draft
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function GmailConnectPrompt() {
  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">
          Connect Gmail
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Connect your Gmail account to view and send email from the inbox.
        </p>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            window.location.assign(
              executorOAuthStartUrl('google_gmail', 'user'),
            )
          }}
        >
          Connect Gmail
        </Button>
      </div>
    </div>
  )
}

export function GmailErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  if (error instanceof ApiError && error.status === 409) {
    return <GmailConnectPrompt />
  }
  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">
          Email did not load
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {error instanceof Error ? error.message : 'Please try again.'}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </div>
  )
}
