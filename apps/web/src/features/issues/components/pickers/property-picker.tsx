import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { cn } from '@garden/ui/lib/utils'

interface PropertyPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactNode
  triggerRender?: React.ReactElement
  width?: string
  align?: 'start' | 'center' | 'end'
  searchable?: boolean
  searchPlaceholder?: string
  onSearchChange?: (query: string) => void
  children: React.ReactNode
}

/**
 * Shared picker shell. Native focus order handles keyboard movement while the
 * component owns only search reset and popover state.
 */
export function PropertyPicker({
  open,
  onOpenChange,
  trigger,
  triggerRender,
  width = 'w-48',
  align = 'end',
  searchable = false,
  searchPlaceholder = 'Filter…',
  onSearchChange,
  children,
}: PropertyPickerProps) {
  const [query, setQuery] = useState('')

  const updateOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen && query) {
      setQuery('')
      onSearchChange?.('')
    }
  }

  return (
    <Popover open={open} onOpenChange={updateOpen}>
      <PopoverTrigger
        render={triggerRender}
        className={cn(
          !triggerRender &&
            '-mx-1 flex cursor-pointer items-center gap-1.5 overflow-hidden rounded px-1 transition-colors hover:bg-accent/30',
        )}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('gap-0 p-0', width)}>
        {searchable ? (
          <div className="border-b px-2 py-1.5">
            <input
              type="search"
              value={query}
              autoFocus
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                const nextQuery = event.currentTarget.value
                setQuery(nextQuery)
                onSearchChange?.(nextQuery)
              }}
            />
          </div>
        ) : null}
        <div className="max-h-60 overflow-y-auto p-1">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

interface PickerItemProps {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  hoverClassName?: string
  children: React.ReactNode
}

/** Single option row with consistent selection affordance. */
export function PickerItem({
  selected,
  disabled = false,
  onClick,
  hoverClassName,
  children,
}: PickerItemProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal',
        hoverClassName,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {selected ? <Check className="size-3.5 text-muted-foreground" /> : null}
    </Button>
  )
}

/** Labels an option group without changing its focus order. */
export function PickerSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={label}>
      <p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </section>
  )
}

export function PickerEmpty() {
  return (
    <p className="px-2 py-3 text-center text-sm text-muted-foreground">
      No results
    </p>
  )
}
