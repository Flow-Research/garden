'use client'

import {
  colorThemeValues,
  useTheme,
} from '@garden/ui/components/common/theme-provider'
import { cn } from '@garden/ui/lib/utils'

const LIGHT_COLORS = {
  titleBar: '#e8e8e8',
  content: '#ffffff',
  sidebar: '#f4f4f5',
  bar: '#e4e4e7',
  barMuted: '#d4d4d8',
}

const DARK_COLORS = {
  titleBar: '#333338',
  content: '#27272a',
  sidebar: '#1e1e21',
  bar: '#3f3f46',
  barMuted: '#52525b',
}

function WindowMockup({
  variant,
  className,
}: {
  variant: 'light' | 'dark'
  className?: string
}) {
  const colors = variant === 'light' ? LIGHT_COLORS : DARK_COLORS

  return (
    <div className={cn('flex h-full w-full flex-col', className)}>
      {/* Title bar */}
      <div
        className="flex items-center gap-[3px] px-2 py-1.5"
        style={{ backgroundColor: colors.titleBar }}
      >
        <span className="size-[6px] rounded-full bg-[#ff5f57]" />
        <span className="size-[6px] rounded-full bg-[#febc2e]" />
        <span className="size-[6px] rounded-full bg-[#28c840]" />
      </div>
      {/* Content area */}
      <div className="flex flex-1" style={{ backgroundColor: colors.content }}>
        {/* Sidebar */}
        <div
          className="w-[30%] space-y-1 p-2"
          style={{ backgroundColor: colors.sidebar }}
        >
          <div
            className="h-1 w-3/4 rounded-full"
            style={{ backgroundColor: colors.bar }}
          />
          <div
            className="h-1 w-1/2 rounded-full"
            style={{ backgroundColor: colors.bar }}
          />
        </div>
        {/* Main */}
        <div className="flex-1 space-y-1.5 p-2">
          <div
            className="h-1.5 w-4/5 rounded-full"
            style={{ backgroundColor: colors.bar }}
          />
          <div
            className="h-1 w-full rounded-full"
            style={{ backgroundColor: colors.barMuted }}
          />
          <div
            className="h-1 w-3/5 rounded-full"
            style={{ backgroundColor: colors.barMuted }}
          />
        </div>
      </div>
    </div>
  )
}

const themeOptions = [
  { value: 'light' as const, label: 'Light' },
  { value: 'dark' as const, label: 'Dark' },
  { value: 'system' as const, label: 'System' },
]

const colorThemeOptions = colorThemeValues.map((value) => ({
  value,
  label: value === 'garden' ? 'Garden' : value,
  description:
    value === 'garden'
      ? 'Garden green accents and surfaces across light and dark modes.'
      : value,
}))

export function AppearanceTab() {
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme()

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <header className="space-y-1">
          <h2 className="text-base font-semibold">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            How Garden looks on this device.
          </p>
        </header>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-5 border-t pt-5"
          role="radiogroup"
          aria-label="Theme"
        >
          {themeOptions.map((opt) => {
            const active = theme === opt.value
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                aria-label={`Select ${opt.label} theme`}
                onClick={() => setTheme(opt.value)}
                className="group flex cursor-pointer flex-col items-start gap-3 rounded-xl text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                <div
                  className={cn(
                    'aspect-[4/3] w-full overflow-hidden rounded-xl border bg-card shadow-sm transition-all duration-150',
                    active
                      ? 'border-brand/50 ring-2 ring-brand/80 shadow-[0_12px_28px_-18px_color-mix(in_oklab,var(--brand)_75%,transparent)]'
                      : 'border-border hover:border-brand/25 hover:bg-accent/30 hover:shadow-md',
                  )}
                >
                  {opt.value === 'system' ? (
                    <div className="relative h-full w-full">
                      <WindowMockup
                        variant="light"
                        className="absolute inset-0"
                      />
                      <WindowMockup
                        variant="dark"
                        className="absolute inset-0 [clip-path:inset(0_0_0_50%)]"
                      />
                    </div>
                  ) : (
                    <WindowMockup variant={opt.value} />
                  )}
                </div>
                <div className="space-y-1">
                  <div
                    className={cn(
                      'text-[0.95rem] transition-colors',
                      active
                        ? 'font-semibold text-foreground'
                        : 'font-medium text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-5">
        <header className="space-y-1">
          <h2 className="text-base font-semibold">Theme</h2>
          <p className="text-sm text-muted-foreground">
            Choose the color palette used across Garden.
          </p>
        </header>
        <div
          className="flex flex-wrap gap-6 border-t pt-5"
          role="radiogroup"
          aria-label="Color theme"
        >
          {colorThemeOptions.map((opt) => {
            const active = colorTheme === opt.value

            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                aria-label={`Select ${opt.label} theme`}
                onClick={() => setColorTheme(opt.value)}
                className="group flex w-44 cursor-pointer flex-col items-start gap-3 rounded-xl text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                <div
                  className={cn(
                    'flex h-28 w-full flex-col overflow-hidden rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all duration-150',
                    active
                      ? 'border-brand/50 ring-2 ring-brand/80 shadow-[0_12px_28px_-18px_color-mix(in_oklab,var(--brand)_75%,transparent)]'
                      : 'border-border hover:border-brand/25 hover:bg-accent/30 hover:shadow-md',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="size-3 rounded-full bg-brand" />
                    <span className="text-[0.95rem] font-semibold text-foreground">
                      {opt.label}
                    </span>
                  </div>
                  <div className="mt-3 grid flex-1 grid-cols-[1fr_1.3fr] gap-2.5">
                    <div className="rounded-md bg-sidebar p-2">
                      <div className="h-2 w-8 rounded-full bg-sidebar-primary" />
                    </div>
                    <div className="rounded-md bg-background p-2 ring-1 ring-border/60">
                      <div className="h-2 w-10 rounded-full bg-brand/70" />
                    </div>
                  </div>
                </div>
                <div className="space-y-1 text-left">
                  <div
                    className={cn(
                      'text-[0.95rem] transition-colors',
                      active
                        ? 'font-semibold text-foreground'
                        : 'font-medium text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </div>
                  <p className="max-w-[28ch] text-sm leading-5 text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
