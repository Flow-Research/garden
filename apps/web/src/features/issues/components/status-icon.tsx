import type { ComponentType } from 'react'
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
} from 'lucide-react'
import { CircleHalf } from '@phosphor-icons/react'
import type { IssueStatus } from '@garden/core/types'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { cn } from '@garden/ui/lib/utils'

/**
 * Design glyphs per workflow state. The Penpot set is Phosphor (circle /
 * circle-half / circle-dashed / check-circle / prohibit / x-circle); Lucide
 * has no half circle, so `in_progress` uses Phosphor's CircleHalf and the
 * remaining states stay Lucide to match the rest of Garden.
 */
const STATUS_ICONS: Record<
  IssueStatus,
  ComponentType<{
    className?: string
    'aria-hidden'?: boolean | 'true' | 'false'
  }>
> = {
  todo: Circle,
  in_progress: CircleHalf,
  in_review: CircleDot,
  done: CircleCheck,
  blocked: Ban,
  cancelled: CircleX,
}

/** Maps workflow states to familiar Lucide symbols shared with the rest of Garden. */
export function StatusIcon({
  status,
  className = 'size-4',
  inheritColor = false,
}: {
  status: IssueStatus
  className?: string
  inheritColor?: boolean
}) {
  const Icon = STATUS_ICONS[status]

  return (
    <Icon
      aria-hidden="true"
      className={cn(
        'shrink-0',
        !inheritColor && STATUS_CONFIG[status].iconColor,
        className,
      )}
    />
  )
}
