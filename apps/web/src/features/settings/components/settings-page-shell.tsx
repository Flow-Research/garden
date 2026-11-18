import type { ComponentProps, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@garden/ui/lib/utils'
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
        <div className="mt-6 min-w-0 sm:mt-10 sm:rounded-xl sm:bg-background-main-secondary sm:p-6 lg:p-10">
          {children}
        </div>
      </div>
    </div>
  )
}

/** White content card that sits on the settings container background. */
export function SettingsPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        // Phones drop the grey container, so cards need their own edge.
        'min-w-0 rounded-lg border bg-background p-4 sm:border-0 sm:p-6',
        className,
      )}
      {...props}
    />
  )
}
