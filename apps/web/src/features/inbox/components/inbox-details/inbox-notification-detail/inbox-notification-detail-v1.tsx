import { useActorName } from '#/lib/workspace/hooks'
import type { InboxItem } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Archive, ExternalLink } from 'lucide-react'
import { typeLabels } from '../../inbox-detail-label'
import { InboxControlPlane } from '../../inbox-control-plane'
import { InboxItemPreviewCard, ctaForInboxItem } from '../../inbox-item-preview'
import { timeAgo } from '../../inbox-list-item'

export function InboxNotificationDetailV1({
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
              {!item.read && <span className="size-1.5 rounded-full bg-brand" />}
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
