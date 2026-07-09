import { contrast } from '../architecture-copy'

/**
 * Garden-vs-bare-harness comparison. Two-column capability table; Garden column
 * is moss-tinted, the bare column muted, so the argument reads at a glance.
 * Grounded in github.com/earendil-works/pi's own README of what it omits.
 */
export function ContrastTable() {
  return (
    <div className="arch-card overflow-hidden">
      <div className="grid grid-cols-[1fr_1fr] border-b border-[color:var(--hairline)] sm:grid-cols-[minmax(0,9rem)_1fr_1fr]">
        <div className="hidden p-4 sm:block" />
        <div className="border-l border-[color:var(--hairline)] p-4">
          <div className="text-[13px] font-semibold text-[color:var(--moss)]">
            Garden
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Think · Workflows · DOs
          </div>
        </div>
        <div className="border-l border-[color:var(--hairline)] p-4">
          <div className="text-[13px] font-semibold text-foreground">
            Bare harness
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            e.g. Pi / a model-API loop
          </div>
        </div>
      </div>

      {contrast.rows.map((row, i) => (
        <div
          key={row.capability}
          className="grid grid-cols-[1fr_1fr] border-b border-[color:var(--hairline-soft)] last:border-0 sm:grid-cols-[minmax(0,9rem)_1fr_1fr]"
        >
          <div className="col-span-2 px-4 pt-3 sm:col-span-1 sm:py-4">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {row.capability}
            </span>
          </div>
          <div
            className="border-l border-[color:var(--hairline-soft)] p-4 text-[13px] leading-6 text-foreground/90"
            style={
              i % 2 === 0
                ? {
                    background:
                      'color-mix(in srgb, var(--moss) 5%, transparent)',
                  }
                : undefined
            }
          >
            {row.garden}
          </div>
          <div className="border-l border-[color:var(--hairline-soft)] p-4 text-[13px] leading-6 text-muted-foreground">
            {row.bare}
          </div>
        </div>
      ))}
    </div>
  )
}
