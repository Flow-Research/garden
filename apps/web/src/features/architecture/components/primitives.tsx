import type { ReactNode } from 'react'
import { cn } from '@garden/ui/lib/utils'

/**
 * Shared presentational primitives for the architecture page. Kept structural
 * (no copy) so the narrative lives in architecture-copy.ts.
 *
 * Design intent: this is a dense technical reference, not a landing page. Favor
 * typographic hierarchy, hairline dividers, and definition lists over filled
 * cards. Cards are reserved for actual diagrams (the planes/actor/lifecycle
 * visuals), not for every list of prose.
 */

/** A numbered, anchorable page section with eyebrow + title + optional lede. */
export function Section({
  id,
  index,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string
  index: string
  eyebrow: string
  title: string
  lede?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-8 border-t border-[color:var(--hairline)] py-14 first:border-t-0"
    >
      <div className="mb-7 max-w-2xl">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[color:var(--moss)]">{index}</span>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </span>
        </div>
        <h2 className="mt-3 text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h2>
        {lede && <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{lede}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Editorial definition list — the page's workhorse layout. A term column (mono,
 * optional amber sub-label) and a prose column, separated by hairline rules.
 * This replaces the old card grids so sections read as a spec, not a pricing
 * page.
 */
export type DefItem = { id?: string; term: ReactNode; sub?: ReactNode; body: ReactNode }

export function DefList({ items }: { items: DefItem[] }) {
  return (
    <dl className="border-t border-[color:var(--hairline)]">
      {items.map((it, i) => (
        <div
          key={it.id ?? i}
          className="grid gap-x-8 gap-y-1.5 border-b border-[color:var(--hairline-soft)] py-5 sm:grid-cols-[12rem_1fr]"
        >
          <dt>
            <div className="font-mono text-[13px] text-foreground">{it.term}</div>
            {it.sub && (
              <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-[color:var(--amber)]">
                {it.sub}
              </div>
            )}
          </dt>
          <dd className="text-[14px] leading-7 text-muted-foreground">{it.body}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Small monospace chip for node/runtime names inside diagrams. */
export function NodeChip({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: 'default' | 'moss' | 'amber'
  className?: string
}) {
  const tones = {
    default: 'text-foreground/90',
    moss: 'text-[color:var(--moss)]',
    amber: 'text-[color:var(--amber)]',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-[color:var(--hairline)] px-2 py-1 font-mono text-[12px]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Section label, all-caps wide tracking — the strongest hierarchy signal. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}
