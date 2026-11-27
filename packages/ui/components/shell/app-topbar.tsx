import { ChevronLeft, ChevronRight, PanelLeft, LayoutGrid } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@garden/ui/lib/utils'

/**
 * App shell top bar — the 40px chrome strip from the redesign: a gray
 * (background.main.secondary) band holding the sidebar toggle, previous/next
 * tab arrows (tabbable surfaces only), the surface's tab strip inline (Chats,
 * Tasks), and the inert squares-four mini-apps glyph at the far right.
 *
 * The arrows step the ACTIVE TAB selection (no horizontal scrolling strip).
 * Tab-arrows render only on tabbable surfaces. The global "+" stays dropped —
 * tabbable surfaces own theirs at the strip's end. Presentational only.
 */

export type AppTopBarProps = {
  onToggleSidebar: () => void
  onPrevious: () => void
  onNext: () => void
  canGoPrevious: boolean
  canGoNext: boolean
  /** Tab arrows render only on tabbable surfaces (Chats, Tasks). */
  showTabArrows?: boolean
  /** The active surface's tab strip, rendered inline after the arrows. */
  tabs?: ReactNode
  className?: string
}

export function AppTopBar({
  onToggleSidebar,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  showTabArrows = false,
  tabs,
  className,
}: AppTopBarProps) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-stretch border-b border-border-default bg-background-main-secondary',
        className,
      )}
    >
      <TopBarButton
        icon={PanelLeft}
        label="Toggle sidebar"
        onClick={onToggleSidebar}
      />
      {showTabArrows ? (
        <>
          <TopBarButton
            icon={ChevronLeft}
            label="Previous tab"
            onClick={onPrevious}
            disabled={!canGoPrevious}
          />
          <TopBarButton
            icon={ChevronRight}
            label="Next tab"
            onClick={onNext}
            disabled={!canGoNext}
          />
        </>
      ) : null}
      {tabs}
      <span
        aria-hidden="true"
        title="Mini apps — coming soon"
        className="ml-auto flex w-10 items-center justify-center self-stretch text-text-tertiary"
      >
        <LayoutGrid className="size-4" />
      </span>
    </div>
  )
}

function TopBarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex w-10 cursor-pointer items-center justify-center self-stretch text-icon-neutral-tertiary transition-colors hover:bg-background-main-secondary-hover hover:text-icon-neutral-default disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon className="size-4" />
    </button>
  )
}
