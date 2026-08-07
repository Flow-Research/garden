import {
  CircleMinus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Siren,
  type LucideIcon,
} from 'lucide-react'
import type { IssuePriority } from '@garden/core/types'
import { PRIORITY_CONFIG } from '@garden/core/issues/config'
import { cn } from '@garden/ui/lib/utils'

const PRIORITY_ICONS: Record<IssuePriority, LucideIcon> = {
  none: CircleMinus,
  low: SignalLow,
  medium: SignalMedium,
  high: SignalHigh,
  urgent: Siren,
}

/** Uses distinct semantic glyphs instead of encoding priority through custom bar geometry. */
export function PriorityIcon({
  priority,
  className,
  inheritColor = false,
}: {
  priority: IssuePriority
  className?: string
  inheritColor?: boolean
}) {
  const Icon = PRIORITY_ICONS[priority]
  const config = PRIORITY_CONFIG[priority]

  return (
    <Icon
      aria-hidden="true"
      className={cn(
        'size-3.5 shrink-0',
        !inheritColor && config.color,
        priority === 'urgent' && 'animate-pulse',
        className,
      )}
    />
  )
}
