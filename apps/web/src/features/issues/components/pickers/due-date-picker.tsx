import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { UpdateIssueRequest } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Calendar } from '@garden/ui/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { cn } from '@garden/ui/lib/utils'

/** Selects or clears a due date while treating the entire current day as not overdue. */
export function DueDatePicker({
  dueDate,
  onUpdate,
  trigger,
  triggerRender,
  align = 'start',
}: {
  dueDate: string | null
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  trigger?: React.ReactNode
  triggerRender?: React.ReactElement
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const selectedDate = dueDate ? new Date(dueDate) : undefined
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const overdue = selectedDate ? selectedDate < startOfToday : false

  const commitDate = (date: Date | undefined) => {
    onUpdate({ due_date: date?.toISOString() ?? null })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={triggerRender}
        className={cn(
          !triggerRender &&
            '-mx-1 flex cursor-pointer items-center gap-1.5 rounded px-1 transition-colors hover:bg-accent/30',
        )}
      >
        {trigger ?? (
          <>
            <CalendarDays className="size-3.5 text-muted-foreground" />
            <span
              className={cn(
                !selectedDate && 'text-muted-foreground',
                overdue && 'text-destructive',
              )}
            >
              {selectedDate
                ? selectedDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : 'Due date'}
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar mode="single" selected={selectedDate} onSelect={commitDate} />
        {selectedDate ? (
          <div className="border-t px-3 py-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => commitDate(undefined)}
            >
              Clear date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
