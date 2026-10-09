import { useActorName } from '#/lib/workspace/hooks'
import type { InboxItem } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Archive } from 'lucide-react'
import { typeLabels } from '../../inbox-detail-label'
import { InboxControlPlane } from '../../inbox-control-plane'
import { InboxItemPreviewCard } from '../../inbox-item-preview'
import { InboxReplyInput } from './inbox-reply-input'

function formatThreadTime(dateStr: string): string {
  const date = new Date(dateStr)
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

function MailHeader({
  actorName,
  email,
  avatarUrl,
  time,
}: {
  actorName: string
  email?: string
  avatarUrl?: string
  time: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="size-9 shrink-0 rounded-full object-cover sm:size-10"
          />
        ) : (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted-foreground/15 text-xs font-semibold text-muted-foreground sm:size-10">
            {actorName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs leading-5">
            <span className="font-semibold text-foreground">{actorName}</span>
            {email && (
              <span className="truncate text-muted-foreground">
                &lt;{email}&gt;
              </span>
            )}
          </div>
          <div className="text-xs leading-5 text-muted-foreground">{time}</div>
        </div>
      </div>
    </div>
  )
}

const RICH_ACTION_TYPES = new Set<InboxItem['type']>([
  'wp_review',
  'waiting_for_input',
  'brain_proposal',
  'review_requested',
])

/** Renders one real API event inside an issue thread. */
function InboxThreadEvent({
  item,
  latest,
}: {
  item: InboxItem
  latest: boolean
}) {
  const { getActorName } = useActorName()
  const actorName =
    item.details?.actor_name ??
    getActorName(
      item.actor_type ?? item.recipient_type,
      item.actor_id ?? item.recipient_id,
    ) ??
    typeLabels[item.type]
  const showPreview = !(latest && RICH_ACTION_TYPES.has(item.type))

  return (
    <article className="rounded-lg border border-border bg-background/50 p-4 sm:p-5">
      <MailHeader
        actorName={actorName}
        email={item.details?.actor_email}
        avatarUrl={item.details?.avatar_url}
        time={formatThreadTime(item.created_at)}
      />
      {showPreview && (
        <div className="mt-4">
          <InboxItemPreviewCard item={item} />
        </div>
      )}
      {latest && (
        <div className="mt-4">
          <InboxControlPlane item={item} />
        </div>
      )}
    </article>
  )
}

export function InboxNotificationDetailV2({
  item,
  items,
  onArchive,
  onOpenIssue,
  onReply,
  submittingReply,
}: {
  item: InboxItem
  items: InboxItem[]
  onArchive: () => void
  onOpenIssue: () => void
  onReply: (content: string) => Promise<boolean>
  submittingReply: boolean
}) {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background p-3 sm:p-5 lg:p-7">
      <div className="min-h-full rounded-lg bg-muted px-4 py-5 text-foreground sm:px-5 sm:py-6 lg:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-normal text-foreground sm:text-xl">
              {item.title}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {items.length} {items.length === 1 ? 'update' : 'updates'} in this
              issue
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onArchive}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-accent sm:px-3"
            >
              <Archive className="size-3.5 shrink-0" />
              Archive thread
            </button>
          </div>
        </div>

        <div className="space-y-4 py-4">
          {items.map((event, index) => (
            <InboxThreadEvent
              key={event.id}
              item={event}
              latest={index === 0}
            />
          ))}

          {item.issue_id && (
            <Button type="button" size="sm" onClick={onOpenIssue}>
              Open issue
            </Button>
          )}

          {item.issue_id && (
            <InboxReplyInput onSubmit={onReply} submitting={submittingReply} />
          )}
        </div>
      </div>
    </div>
  )
}
