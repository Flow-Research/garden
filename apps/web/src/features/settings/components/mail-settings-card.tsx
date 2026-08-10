/**
 * MODIFIED OPENSHIP SOURCE: the `soft` and `split` density modes mechanically
 * adapt OpenShip's mail-admin SectionCard at commit
 * 738946188e7c329477a4bbcf9c58dc1451393798 (Apache-2.0). The outer settings
 * hierarchy remains adapted from Zero's SettingsCard (MIT). See
 * docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.
 */

import type { ReactNode } from 'react'
import { cn } from '@garden/ui/lib/utils'

export function MailSettingsCard({
  title,
  description,
  action,
  children,
  footer,
  density = 'soft',
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  footer?: ReactNode
  density?: 'soft' | 'split'
  className?: string
}) {
  if (density === 'split') {
    return (
      <section
        className={cn('overflow-hidden rounded-xl border bg-card', className)}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
        <div>{children}</div>
        {footer ? <div className="border-t px-5 py-4">{footer}</div> : null}
      </section>
    )
  }

  return (
    <section className={cn('rounded-xl border bg-card p-5', className)}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="mt-5">{children}</div>
      {footer ? <div className="mt-5 border-t pt-4">{footer}</div> : null}
    </section>
  )
}
