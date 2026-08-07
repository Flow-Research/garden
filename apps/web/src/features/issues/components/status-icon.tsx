import {
  Ban,
  Circle,
  CircleCheck,
  CircleDot,
  CircleDotDashed,
  CircleX,
  type LucideIcon,
} from 'lucide-react'
import type { IssueStatus } from '@garden/core/types'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { cn } from '@garden/ui/lib/utils'

const STATUS_ICONS: Record<IssueStatus, LucideIcon> = {
  todo: Circle,
  in_progress: CircleDotDashed,
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
