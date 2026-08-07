import type { IssuePriority, UpdateIssueRequest } from '@garden/core/types'
import { PRIORITY_CONFIG, PRIORITY_ORDER } from '@garden/core/issues/config'
import { PriorityIcon } from '../priority-icon'
import { EnumPropertyPicker } from './enum-property-picker'

const PRIORITY_OPTIONS = PRIORITY_ORDER.map((value) => ({
  label: PRIORITY_CONFIG[value].label,
  value,
  visual: <PriorityIcon inheritColor priority={value} />,
}))

/** Presents the canonical priority order through the shared property-picker shell. */
export function PriorityPicker({
  priority,
  onUpdate,
  trigger,
  triggerRender,
  open: controlledOpen,
  onOpenChange,
  align,
}: {
  priority: IssuePriority
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  trigger?: React.ReactNode
  triggerRender?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  const current = PRIORITY_CONFIG[priority]

  return (
    <EnumPropertyPicker
      align={align}
      current={priority}
      onOpenChange={onOpenChange}
      onSelect={(value) => onUpdate({ priority: value })}
      open={controlledOpen}
      options={PRIORITY_OPTIONS}
      renderOption={(option) => {
        const config = PRIORITY_CONFIG[option.value]
        return (
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${config.badgeBg} ${config.badgeText}`}
          >
            {option.visual}
            {option.label}
          </span>
        )
      }}
      triggerRender={triggerRender}
      trigger={
        trigger ?? (
          <>
            <PriorityIcon priority={priority} />
            <span className="truncate">{current.label}</span>
          </>
        )
      }
    />
  )
}
