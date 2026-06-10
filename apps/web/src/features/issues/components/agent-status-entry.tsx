import { Sparkles } from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import { ActorAvatar } from '../../common/actor-avatar'
import { ReadonlyContent } from '../../editor'
import { useActorName } from '@/lib/workspace/hooks'
import { timeAgo } from '@garden/core/utils'
import type { TimelineEntry } from '@garden/core/types'

/**
 * Agent-authored entries on the issue timeline render as a compact status row,
 * not a comment bubble. Reads like an activity event with a body, not a
 * conversation reply. Member-authored entries keep the full CommentCard.
 *
 * Used by issue-detail to differentiate agent moves ("Garden looked at the
 * GitHub PR") from member notes (sticky-note style cards).
 */
export function AgentStatusEntry({
  entry,
  highlighted,
}: {
  entry: TimelineEntry
  highlighted?: boolean
}) {
  const { getActorName } = useActorName()
  const isShort =
    !entry.content ||
    (entry.content.length <= 200 && !entry.content.includes('\n\n'))

  if (isShort) {
    return (
      <div
        id={`comment-${entry.id}`}
        className={cn(
          'flex items-start gap-2.5 rounded-md px-3 py-2 transition-colors duration-700',
          highlighted && 'bg-brand/5 ring-1 ring-brand/30',
        )}
      >
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <ActorAvatar
          actorType={entry.actor_type}
          actorId={entry.actor_id}
          size={20}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1 text-sm leading-snug text-foreground/85">
          <span className="font-medium">
            {getActorName(entry.actor_type, entry.actor_id)}
          </span>{' '}
          <span className="text-foreground/85">{entry.content?.trim()}</span>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {timeAgo(entry.created_at)}
        </span>
      </div>
    )
  }

  return (
    <div
      id={`comment-${entry.id}`}
      className={cn(
        'rounded-md border border-dashed bg-muted/20 px-3 py-2.5 transition-colors duration-700',
        highlighted && 'ring-1 ring-brand/30 bg-brand/5',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        <span className="font-medium text-foreground/85">
          {getActorName(entry.actor_type, entry.actor_id)}
        </span>
        <span>·</span>
        <span>{timeAgo(entry.created_at)}</span>
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-foreground/85">
        <ReadonlyContent content={entry.content ?? ''} />
      </div>
    </div>
  )
}
