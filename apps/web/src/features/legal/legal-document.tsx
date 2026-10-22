import type { ReactNode } from 'react'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'

/**
 * Gives public legal documents one calm, readable shell that still belongs to
 * Garden. The app document locks body scrolling for the workspace, so this
 * surface owns its own viewport scroll instead of inheriting workspace chrome.
 * Internal links stay plain anchors so these pages remain useful even before
 * the client router hydrates. Routing references: installed TanStack Router
 * core and navigation guidance.
 */
export function LegalDocument({
  title,
  summary,
  effectiveDate,
  children,
}: {
  title: string
  summary: string
  effectiveDate: string
  children: ReactNode
}) {
  return (
    <div className="h-dvh overflow-y-auto overscroll-y-contain text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 lg:px-10">
          <a
            href="/login"
            className="inline-flex items-center gap-2 text-sm font-semibold transition-colors hover:text-success"
          >
            <BrandIcon className="size-4" bordered noSpin size="sm" />
            Garden
          </a>
          <a
            href="/login"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to sign in
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 lg:px-10 lg:py-16">
        <header className="border-b border-border/60 pb-10">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-success">
            Legal
          </p>
          <h1 className="font-prose mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="font-prose mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            {summary}
          </p>
          <p className="mt-5 text-xs text-muted-foreground">
            Effective {effectiveDate}
          </p>
        </header>

        <article className="font-prose pb-12 text-[15px] leading-7 text-foreground/90 [&_a]:font-medium [&_a]:text-success [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-12 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:mt-2 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:mt-4 [&_strong]:font-semibold [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          {children}
        </article>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-xs text-muted-foreground lg:px-10">
          <span>© 2026 Flow Research</span>
          <a className="hover:text-foreground" href="/privacy">
            Privacy
          </a>
          <a className="hover:text-foreground" href="/terms">
            Terms
          </a>
        </div>
      </footer>
    </div>
  )
}
