import type { ReactElement, ReactNode } from 'react'
import { PickerItem, PropertyPicker } from './property-picker'
import { usePickerOpen } from './picker-state'

type EnumOption<Value extends string> = {
  hoverClassName?: string
  label: string
  value: Value
  visual: ReactNode
}

/** Renders compact issue-enum selectors from canonical config data. */
export function EnumPropertyPicker<Value extends string>({
  align,
  current,
  onOpenChange,
  onSelect,
  open: controlledOpen,
  options,
  renderOption,
  trigger,
  triggerRender,
}: {
  align?: 'start' | 'center' | 'end'
  current: Value
  onOpenChange?: (open: boolean) => void
  onSelect: (value: Value) => void
  open?: boolean
  options: readonly EnumOption<Value>[]
  renderOption?: (option: EnumOption<Value>) => ReactNode
  trigger: ReactNode
  triggerRender?: ReactElement
}) {
  const [open, setOpen] = usePickerOpen(controlledOpen, onOpenChange)

  return (
    <PropertyPicker
      align={align}
      onOpenChange={setOpen}
      open={open}
      trigger={trigger}
      triggerRender={triggerRender}
      width="w-44"
    >
      {options.map((option) => (
        <PickerItem
          hoverClassName={option.hoverClassName}
          key={option.value}
          onClick={() => {
            onSelect(option.value)
            setOpen(false)
          }}
          selected={option.value === current}
        >
          {renderOption?.(option) ?? (
            <>
              {option.visual}
              <span>{option.label}</span>
            </>
          )}
        </PickerItem>
      ))}
    </PropertyPicker>
  )
}
