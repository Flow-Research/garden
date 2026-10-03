import type { ComponentType, ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
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
 *
 * Nav items may declare children (Penpot Teams_Main: caret row + 32px indented
 * sub-rows). Expansion is owned by the app; the caret is a separate button so
 * the parent row can still navigate.
 */

export type AppSidebarNavChild = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
}

export type AppSidebarNavItem = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  badge?: number
  children?: AppSidebarNavChild[]
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
  /** Child row to highlight (child ids never equal parent ids). */
  activeChildId?: string | null
  expandedIds?: string[]
  onToggleExpand?: (id: string) => void
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
  activeChildId = null,
  expandedIds = [],
  onToggleExpand,
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
            const hasChildren = !collapsed && (item.children?.length ?? 0) > 0
            const expanded = hasChildren && expandedIds.includes(item.id)
            return (
              <li key={item.id}>
                <div
                  className={cn(
                    'flex h-10 w-full items-center rounded-sm transition-colors',
                    active
                      ? 'bg-background-main-secondary'
                      : 'hover:bg-background-main-secondary-hover',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm',
                      collapsed ? 'justify-center px-0' : 'px-2',
                      active
                        ? 'font-medium text-text-brand-secondary'
                        : 'text-text-secondary hover:text-text-neutral-default',
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
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-pill bg-red-500 px-1 text-xs leading-none text-red-100">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </button>
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => onToggleExpand?.(item.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.label}`}
                      className={cn(
                        'mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm',
                        active
                          ? 'text-icon-brand-secondary'
                          : 'text-icon-neutral-tertiary hover:text-icon-neutral-secondary',
                      )}
                    >
                      {expanded ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </button>
                  ) : null}
                </div>

                {expanded ? (
                  <ul className="mt-1 flex flex-col gap-1">
                    {item.children?.map((child) => {
                      const childActive = child.id === activeChildId
                      return (
                        <li key={child.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(child.id)}
                            aria-current={childActive ? 'page' : undefined}
                            className={cn(
                              'group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-sm pl-8 pr-2 text-sm transition-colors',
                              childActive
                                ? 'bg-background-main-secondary font-medium text-text-brand-secondary'
                                : 'text-text-secondary hover:bg-background-main-secondary-hover hover:text-text-neutral-default',
                            )}
                          >
                            <child.icon
                              className={cn(
                                'size-4 shrink-0',
                                childActive
                                  ? 'text-icon-brand-secondary'
                                  : 'text-icon-neutral-tertiary group-hover:text-icon-neutral-secondary',
                              )}
                            />
                            <span className="flex-1 truncate text-left">
                              {child.label}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
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
