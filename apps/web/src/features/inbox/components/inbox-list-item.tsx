'use client'

import { cn } from '@garden/ui/lib/utils'
import { Archive } from 'lucide-react'
import { useActorName } from '@garden/core/workspace/hooks'
import type { InboxItem } from '@garden/core/types'
import { InboxDetailLabel, typeLabels } from './inbox-detail-label'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export { timeAgo }

export function InboxListItem({
  item,
  isSelected,
  onClick,
  onArchive,
}: {
  item: InboxItem
  isSelected: boolean
  onClick: () => void
  onArchive: () => void
}) {
  const { getActorName } = useActorName()
  const actorName =
    getActorName(
      item.actor_type ?? item.recipient_type,
      item.actor_id ?? item.recipient_id,
    ) || typeLabels[item.type]

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex w-full flex-col items-start gap-2 border-b p-4 text-left text-sm leading-tight transition-colors last:border-b-0',
        isSelected
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      {/* Row 1: actor + timestamp */}
      <div className="flex w-full items-center gap-2">
        {!item.read && (
          <span className="size-1.5 shrink-0 rounded-full bg-brand" />
        )}
        <span
          className={cn(
            'truncate',
            !item.read ? 'font-medium' : 'text-muted-foreground',
          )}
        >
          {actorName}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {timeAgo(item.created_at)}
        </span>
      </div>

      {/* Row 2: subject */}
      <span className="w-full truncate font-medium">{item.title}</span>

      {/* Row 3: teaser */}
      <span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-muted-foreground">
        <InboxDetailLabel item={item} />
      </span>

      {/* Archive action on hover */}
      <span
        role="button"
        tabIndex={-1}
        title="Archive"
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
        className="absolute top-3 right-3 hidden rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:inline-flex"
      >
        <Archive className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}
