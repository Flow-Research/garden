import type { IssueStatus, UpdateIssueRequest } from '@garden/core/types'
import { ALL_STATUSES, STATUS_CONFIG } from '@garden/core/issues/config'
import { StatusIcon } from '../status-icon'
import { EnumPropertyPicker } from './enum-property-picker'

const STATUS_OPTIONS = ALL_STATUSES.map((value) => ({
  hoverClassName: STATUS_CONFIG[value].hoverBg,
  label: STATUS_CONFIG[value].label,
  value,
  visual: <StatusIcon className="size-3.5" status={value} />,
}))

/** Presents every issue state using canonical labels, colors, and glyphs. */
export function StatusPicker({
  status,
  onUpdate,
  trigger,
  triggerRender,
  open: controlledOpen,
  onOpenChange,
  align,
}: {
  status: IssueStatus
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  trigger?: React.ReactNode
  triggerRender?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  const current = STATUS_CONFIG[status]

  return (
    <EnumPropertyPicker
      align={align}
      current={status}
      onOpenChange={onOpenChange}
      onSelect={(value) => onUpdate({ status: value })}
      open={controlledOpen}
      options={STATUS_OPTIONS}
      triggerRender={triggerRender}
      trigger={
        trigger ?? (
          <>
            <StatusIcon status={status} className="size-3.5" />
            <span className="truncate">{current.label}</span>
          </>
        )
      }
    />
  )
}
