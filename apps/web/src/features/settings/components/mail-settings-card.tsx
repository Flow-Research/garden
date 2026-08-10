// Directly adapts Zero's SettingsCard composition (MIT).
// Pinned source and license: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import type { ReactNode } from 'react'

export function MailSettingsCard({
  title,
  description,
  action,
  children,
  footer,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
      {footer ? <div className="border-t pt-4">{footer}</div> : null}
    </section>
  )
}
