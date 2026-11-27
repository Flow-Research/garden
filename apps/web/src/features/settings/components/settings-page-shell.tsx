import type { ComponentProps, ReactNode } from 'react'
import { Link, useChildMatches } from '@tanstack/react-router'
import { MotionConfig, motion } from 'motion/react'
import { cn } from '@garden/ui/lib/utils'
import {
  CircleUserRound,
  Settings,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react'
import { ANIMATE_EASE, Animate } from '@/components/animate'

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

const SECTION_MOTION = { duration: 0.32, ease: ANIMATE_EASE }

/**
 * Shared frame for routed settings. Section content fades in on each section
 * change and the active underline slides between tabs; sub-routes inside a
 * section keep their content still.
 */
export function SettingsPageShell({ children }: { children: ReactNode }) {
  // Keyed by the child match the Outlet renders, not the location: the
  // location changes on click while the Outlet still shows the previous
  // section until the next route loads, which would replay the fade on stale
  // content and then swap it abruptly.
  const section = useChildMatches({
    select: (matches) => matches[0]?.pathname.split('/')[2] ?? '',
  })
  return (
    <MotionConfig reducedMotion="user">
      <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
          <header>
            <h1 className="text-xl font-semibold tracking-tight">
              All settings
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              Make changes to specific parts of the platform to suit your need.
            </p>
          </header>
          <motion.nav
            layoutScroll
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
                  className="relative flex shrink-0 items-center gap-3 px-5 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:text-foreground"
                >
                  {({ isActive }) => (
                    <>
                      <Icon aria-hidden="true" className="size-5" />
                      {label}
                      {isActive ? (
                        <motion.span
                          aria-hidden
                          layoutId="settings-section-underline"
                          className="absolute inset-x-0 bottom-0 h-0.5 bg-brand"
                          transition={SECTION_MOTION}
                        />
                      ) : null}
                    </>
                  )}
                </Link>
              ))}
            </div>
          </motion.nav>
          <div className="mt-6 min-w-0 sm:mt-10 lg:rounded-xl lg:bg-background-main-secondary lg:p-10">
            <Animate
              key={section}
              transition="fade-left"
              duration={SECTION_MOTION.duration * 1000}
              className="min-w-0"
            >
              {children}
            </Animate>
          </div>
        </div>
      </motion.div>
    </MotionConfig>
  )
}

/** White content card that sits on the settings container background. */
export function SettingsPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        // Below lg there is no grey container, so cards need their own edge.
        'min-w-0 rounded-lg border bg-background p-4 sm:p-6 lg:border-0',
        className,
      )}
      {...props}
    />
  )
}
