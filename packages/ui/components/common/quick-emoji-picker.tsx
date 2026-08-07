import { lazy, Suspense, useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { cn } from '@garden/ui/lib/utils'

const EmojiPicker = lazy(() =>
  import('./emoji-picker').then(({ EmojiPicker: Picker }) => ({
    default: Picker,
  })),
)

const COMMON_REACTIONS = [
  '👍',
  '👌',
  '❤️',
  '😄',
  '🎉',
  '😕',
  '🚀',
  '👀',
] as const

interface QuickEmojiPickerProps {
  onSelect: (emoji: string) => void
  align?: 'start' | 'end'
  className?: string
}

/** Offers the common reaction set immediately and loads the full picker on demand. */
function QuickEmojiPicker({
  onSelect,
  align = 'start',
  className,
}: QuickEmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<'quick' | 'all'>('quick')

  const selectEmoji = (emoji: string) => {
    onSelect(emoji)
    setPanel('quick')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPanel('quick')
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn('rounded-full text-muted-foreground', className)}
            aria-label="Add reaction"
          >
            <SmilePlus />
          </Button>
        }
      />
      <PopoverContent align={align} className="w-auto p-0">
        {panel === 'all' ? (
          <Suspense
            fallback={
              <p className="p-4 text-sm text-muted-foreground">
                Loading emojis…
              </p>
            }
          >
            <EmojiPicker onSelect={selectEmoji} />
          </Suspense>
        ) : (
          <div className="p-2">
            <div className="flex gap-1" aria-label="Common reactions">
              {COMMON_REACTIONS.map((emoji) => (
                <Button
                  key={emoji}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-base"
                  onClick={() => selectEmoji(emoji)}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mt-1.5 w-full text-muted-foreground"
              onClick={() => setPanel('all')}
            >
              Browse all emojis
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { QuickEmojiPicker }
