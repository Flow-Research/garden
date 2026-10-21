import type { ComponentType, ReactNode } from 'react'
import { cn } from '@garden/ui/lib/utils'

/**
 * App shell sidebar — the flat, labeled navigation column from the redesign
 * (Penpot "Garden" file, 2026-09): fixed 240px, wordmark header, icon+label nav
 * rows with optional count badges, user card pinned to the bottom.
 *
 * This replaces the old two-tier rail (icon rail + per-context explorer rail).
 * It is presentational only: routing, badge counts, and the user menu are
 * wired by the app through props. Token mapping: active row uses
 * background.main.secondary fill + text.brand.secondary label; idle rows use
 * text.secondary; badges use badge red tokens via utility classes below.
 */

export type AppSidebarNavItem = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  badge?: number
}

export type AppSidebarProps = {
  /**
   * Header slot — the workspace switcher (logo + workspace name + chevron
   * dropdown). The app owns workspace data; the sidebar owns layout only.
   * Sidebar collapse is owned by the top bar (no header control here).
   */
  header: ReactNode
  items: AppSidebarNavItem[]
  activeId: string | null
  onSelect: (id: string) => void
  collapsed: boolean
  /** User card slot (account flyout) rendered at the bottom. */
  userCard: ReactNode
  className?: string
}

export function AppSidebar({
  header,
  items,
  activeId,
  onSelect,
  collapsed,
  userCard,
  className,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Primary"
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border-default bg-background-main-default transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-60',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-10 shrink-0 items-center',
          collapsed ? 'justify-center px-0' : 'px-4',
        )}
      >
        {header}
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-4" aria-label="Surfaces">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = item.id === activeId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group cursor-pointer flex h-10 w-full items-center gap-2.5 rounded-sm text-sm transition-colors',
                    collapsed ? 'justify-center px-0' : 'px-2',
                    active
                      ? 'bg-background-main-secondary font-medium text-text-brand-secondary'
                      : 'text-text-secondary hover:bg-background-main-secondary-hover hover:text-text-neutral-default',
                  )}
                >
                  <item.icon
                    className={cn(
                      'size-5 shrink-0',
                      active
                        ? 'text-icon-brand-secondary'
                        : 'text-icon-neutral-tertiary group-hover:text-icon-neutral-secondary',
                    )}
                  />
                  {!collapsed ? (
                    <span className="flex-1 truncate text-left">
                      {item.label}
                    </span>
                  ) : null}
                  {!collapsed &&
                  typeof item.badge === 'number' &&
                  item.badge > 0 ? (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-pill bg-background-danger-default px-1 text-xs leading-none text-text-danger-on-danger">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div
        className={cn(
          'shrink-0 px-4 pb-8',
          collapsed && 'flex justify-center px-2',
        )}
      >
        {userCard}
      </div>
    </aside>
  )
}
