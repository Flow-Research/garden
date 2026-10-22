import type { ComponentType } from 'react'
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
} from 'lucide-react'
import type { IssueStatus } from '@garden/core/types'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { cn } from '@garden/ui/lib/utils'

/**
 * Design glyphs per workflow state. The Penpot set is circle / circle-dashed /
 * check-circle / prohibit / x-circle; Lucide covers each state so the whole app
 * shares one icon library.
 */
const STATUS_ICONS: Record<
  IssueStatus,
  ComponentType<{
    className?: string
    'aria-hidden'?: boolean | 'true' | 'false'
  }>
> = {
  todo: Circle,
  in_progress: CircleDashed,
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
