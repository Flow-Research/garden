import { Plus, X } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@garden/ui/lib/utils'

/**
 * Surface-scoped tab strip (Chats, Tasks) — rendered INLINE in the AppTopBar's
 * gray chrome band (the design's Layout_Tab strip hosts tabs + arrows together). Replaces the retired global FlexLayout dock:
 * instead of app-wide tabs, only surfaces that opted in render this strip and
 * own their tab state and their "+" action.
 *
 * Styling on the gray top-bar band: inactive tabs are quiet text on the band
 * (hover lifts them); the active tab is a white block punching into the
 * content below. No horizontal scroll — the top-bar arrows step the selection
 * when tabs overflow.
 */

export type SurfaceTab = {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
}

export type SurfaceTabsProps = {
  tabs: SurfaceTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  /** Accessible label + tooltip for the "+" button, e.g. "New chat". */
  newLabel: string
  /** Optional trailing content (e.g. a session-browser trigger). */
  end?: ReactNode
  className?: string
}

export function SurfaceTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  newLabel,
  end,
  className,
}: SurfaceTabsProps) {
  // A nav of open documents, like browser tabs. It used role="tablist" with
  // role="tab" on a non-focusable wrapper around two buttons, which screen
  // readers announced as tabs that could not be focused or selected.
  return (
    <nav
      aria-label="Open tabs"
      className={cn('flex h-full min-w-0 flex-1 items-stretch', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <div
            key={tab.id}
            className={cn(
              'group relative flex w-36 min-w-0 items-stretch text-sm',
              active
                ? 'z-10 border-x border-t border-border-default bg-background-main-default font-medium text-text-neutral-default'
                : 'text-text-secondary hover:bg-background-main-secondary-hover hover:text-text-neutral-default',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={active ? 'page' : undefined}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {tab.icon ? (
                <tab.icon className="size-3.5 shrink-0 text-icon-neutral-tertiary" />
              ) : null}
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              aria-label={`Close ${tab.title}`}
              className={cn(
                'flex w-6 shrink-0 cursor-pointer items-center justify-center text-icon-neutral-tertiary transition-opacity hover:text-icon-neutral-default',
                active
                  ? 'opacity-100'
                  : // Reveal on keyboard focus too, not hover only.
                    'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
              )}
            >
              <X className="size-2.5" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={onNew}
        aria-label={newLabel}
        title={newLabel}
        className="flex w-10 shrink-0 cursor-pointer items-center justify-center self-stretch text-icon-neutral-tertiary transition-colors hover:bg-background-main-secondary-hover hover:text-icon-neutral-default"
      >
        <Plus className="size-3.5" />
      </button>
      {end ? (
        <div className="ml-auto flex items-center px-1.5">{end}</div>
      ) : null}
    </nav>
  )
}
