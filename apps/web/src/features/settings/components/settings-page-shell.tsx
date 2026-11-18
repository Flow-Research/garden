import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CircleUserRound,
  Settings,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react'

const sections = [
  { to: '/settings/profile', label: 'Profile', icon: CircleUserRound },
  {
    to: '/settings/user-management',
    label: 'User Management',
    icon: UsersRound,
  },
  {
    to: '/settings/preferences',
    label: 'Preferences',
    icon: SlidersHorizontal,
  },
  { to: '/settings/general', label: 'General', icon: Settings },
] as const

/**
 * Primary-surface card for settings content that sits on the shell's
 * secondary container. Sections whose design places content directly on the
 * secondary surface, like User Management's Team grid, skip it.
 */
export function SettingsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-background p-4 sm:p-6">
      {children}
    </div>
  )
}

/** Shared frame for routed settings while section content is redesigned. */
export function SettingsPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">All settings</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Make changes to specific parts of the platform to suit your need.
          </p>
        </header>
        <nav
          aria-label="Settings sections"
          className="mt-10 overflow-x-auto pb-1"
        >
          <div className="flex w-max border-b border-border bg-background-main-secondary">
            {sections.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                preload="intent"
                activeOptions={{ exact: false }}
                className="flex shrink-0 items-center gap-3 border-b-2 border-transparent px-5 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:border-brand aria-[current=page]:text-foreground"
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="mt-10 min-w-0 rounded-2xl bg-background-main-secondary p-4 sm:p-6 lg:p-10">
          {children}
        </div>
      </div>
    </div>
  )
}
