import { CheckCircle, Circle, CircleHalf } from '@phosphor-icons/react'
import { MoreVertical } from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'

const SUMMARY_STATUS_ICONS = {
  todo: { Icon: Circle, color: 'text-muted-foreground' },
  in_progress: { Icon: CircleHalf, color: 'text-warning' },
  done: { Icon: CheckCircle, color: 'text-success' },
} as const

/**
 * Leading glyph for a status summary card, matching the Penpot design's card
 * icons (circle / circle-half / check-circle) and their colors (neutral /
 * warning / success). The design renders these at 18px, 12px before the label.
 */
export function TeamSummaryStatusIcon({
  status,
}: {
  status: keyof typeof SUMMARY_STATUS_ICONS
}) {
  const { Icon, color } = SUMMARY_STATUS_ICONS[status]

  return <Icon aria-hidden="true" className={cn('size-[18px] shrink-0', color)} />
}

/**
 * The Teams design's summary card (label over value, optional trailing
 * action/menu), shared by the admin overview and the Team detail tabs so the
 * two surfaces stay pixel-identical: 113px tall, 0.5px border, radius 16.
 * Values below 10 are zero-padded ("05") and larger values are grouped
 * ("3,029") per the design frames.
 */
export function TeamSummaryCard({
  label,
  value,
  icon,
  action,
}: {
  label: string
  value: number
  icon?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[113px] min-w-0 flex-1 flex-col gap-2 rounded-xl border-[0.5px] border-border-default bg-background-main-default p-4">
      <span className="flex items-center gap-3 text-sm text-text-secondary">
        {icon}
        {label}
      </span>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {value < 10 ? `0${value}` : value.toLocaleString()}
        </span>
        {action}
      </div>
    </div>
  )
}

/**
 * The ⋯ menu the design puts on every Team detail summary card. Items are
 * caller-supplied so each tab can cross-link to the surface that explains the
 * number (P1-only destinations render disabled).
 */
export function TeamSummaryMenu({
  items,
}: {
  items: { label: string; disabled?: boolean; onSelect?: () => void }[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Summary actions"
            className="text-icon-secondary"
            size="icon"
            variant="ghost"
          />
        }
      >
        <MoreVertical className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            disabled={item.disabled}
            key={item.label}
            onClick={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
