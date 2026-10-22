import { Archive, CalendarDays } from 'lucide-react'
import { useActorName } from '@/lib/workspace/hooks'
import type { InboxItem } from '@garden/core/types'
import { cn } from '@garden/ui/lib/utils'

function formatInboxDate(dateStr: string): string {
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

export function InboxListItemV2({
  item,
  eventCount,
  isSelected,
  onClick,
  onArchive,
}: {
  item: InboxItem
  eventCount: number
  isSelected: boolean
  onClick: () => void
  onArchive: () => void
}) {
  const { getActorName } = useActorName()
  const actorName =
    item.details?.actor_name ??
    getActorName(
      item.actor_type ?? item.recipient_type,
      item.actor_id ?? item.recipient_id,
    ) ??
    'Garden'

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
      {item.details?.avatar_url ? (
        <img
          src={item.details.avatar_url}
          alt=""
          className="mt-0.5 size-8 rounded-full object-cover"
        />
      ) : (
        <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-muted-foreground/15 text-xs font-semibold text-muted-foreground">
          {actorName.slice(0, 1).toUpperCase()}
        </span>
      )}

      <div className="min-w-0">
        <span className="truncate text-[13px] font-semibold leading-5 text-foreground">
          {actorName}
        </span>

        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-muted-foreground">
            {item.title}
          </p>
          {eventCount > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {eventCount}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium leading-4 text-foreground">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            <span>{formatInboxDate(item.created_at)}</span>
          </div>
          {!item.read && (
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium leading-4 text-emerald-700">
              New
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        title="Archive"
        aria-label={`Archive thread for ${item.title}`}
        onClick={(e) => {
          e.stopPropagation()
          onArchive()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            onArchive()
          }
        }}
        className="absolute top-3 right-3 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
