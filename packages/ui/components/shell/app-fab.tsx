import { Sparkle } from '@phosphor-icons/react'
import { cn } from '@garden/ui/lib/utils'

/**
 * Harnessy floating action button (Penpot "Harnessy_FAB"): 40px pill-round
 * button with the purple→blue brand gradient and white Sparkle, fixed to the
 * bottom-right of the content pane. Shell-only for now — `onClick` is wired by
 * the app; the Harnessy popover lands separately.
 */
export type AppFabProps = {
  onClick?: () => void
  className?: string
}

export function AppFab({ onClick, className }: AppFabProps) {
  return (
    <button
      type="button"
      aria-label="Open Harnessy"
      onClick={onClick}
      className={cn(
        'absolute bottom-5 right-5 z-40 flex size-10 cursor-pointer items-center justify-center rounded-full text-white shadow-[var(--shadow-float-1)] transition-transform hover:scale-105 active:scale-95',
        className,
      )}
      style={{
        backgroundImage: 'linear-gradient(180deg, #8a38f5 0%, #177cff 100%)',
      }}
    >
      <Sparkle className="size-5" weight="fill" />
    </button>
  )
}
