import { Button } from '@garden/ui/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@garden/ui/components/ui/tooltip'
import { cn } from '@garden/ui/lib/utils'
import { QuickEmojiPicker } from './quick-emoji-picker'

interface ReactionItem {
  id: string
  actor_type: string
  actor_id: string
  emoji: string
}

interface ReactionSummary {
  emoji: string
  actorKeys: Array<{ type: string; id: string }>
  selectedByCurrentUser: boolean
}

/** Collapses reaction records into stable first-seen emoji groups for display. */
function summarizeReactions(
  reactions: ReactionItem[],
  currentUserId?: string,
): ReactionSummary[] {
  const summaries = new Map<string, ReactionSummary>()

  for (const reaction of reactions) {
    const summary = summaries.get(reaction.emoji) ?? {
      emoji: reaction.emoji,
      actorKeys: [],
      selectedByCurrentUser: false,
    }
    summary.actorKeys.push({ type: reaction.actor_type, id: reaction.actor_id })
    summary.selectedByCurrentUser ||=
      reaction.actor_type === 'member' && reaction.actor_id === currentUserId
    summaries.set(reaction.emoji, summary)
  }

  return [...summaries.values()]
}

interface ReactionBarProps {
  reactions: ReactionItem[]
  currentUserId?: string
  onToggle: (emoji: string) => void
  getActorName: (type: string, id: string) => string
  className?: string
  hideAddButton?: boolean
}

/** Renders grouped reactions with participant names and an optional add control. */
function ReactionBar({
  reactions,
  currentUserId,
  onToggle,
  getActorName,
  className,
  hideAddButton = false,
}: ReactionBarProps) {
  const summaries = summarizeReactions(reactions, currentUserId)

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {summaries.map((summary) => (
        <Tooltip key={summary.emoji}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-pressed={summary.selectedByCurrentUser}
                className={cn(
                  'h-6 rounded-full px-2 font-normal',
                  summary.selectedByCurrentUser &&
                    'border-brand/30 bg-brand/10 text-brand',
                )}
                onClick={() => onToggle(summary.emoji)}
              >
                <span aria-hidden="true">{summary.emoji}</span>
                <span>{summary.actorKeys.length}</span>
              </Button>
            }
          />
          <TooltipContent>
            {summary.actorKeys
              .map(({ type, id }) => getActorName(type, id))
              .join(', ')}
          </TooltipContent>
        </Tooltip>
      ))}
      {hideAddButton ? null : <QuickEmojiPicker onSelect={onToggle} />}
    </div>
  )
}

export { ReactionBar, type ReactionBarProps, type ReactionItem }
