import { planes } from '../architecture-copy'
import { NodeChip } from './primitives'

/**
 * Three-planes diagram: Control / Agent / Execution stacked as bands. The
 * browser sits above; the planes connect top→bottom. Hand-built (no mermaid) so
 * it matches the page palette. Real bindings only — see docs/core/technical.md.
 */
const accent: Record<string, string> = {
  control: 'var(--slate)',
  agent: 'var(--moss)',
  execution: 'var(--amber)',
}

export function PlanesDiagram() {
  return (
    <div className="space-y-3">
      <div className="mx-auto w-fit rounded-lg border border-[color:var(--hairline)] bg-[color:var(--parchment-deep)] px-4 py-2 text-center font-mono text-[12px] text-muted-foreground">
        Browser · TanStack Start
      </div>
      <div
        className="mx-auto h-5 w-px bg-[color:var(--hairline)]"
        aria-hidden
      />

      <div className="space-y-3">
        {planes.map((plane) => (
          <div
            key={plane.id}
            className="arch-card overflow-hidden"
            style={{ borderLeft: `2px solid ${accent[plane.id]}` }}
          >
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-6">
              <div className="sm:w-52 sm:shrink-0">
                <div className="text-[15px] font-semibold text-foreground">
                  {plane.name}
                </div>
                <div
                  className="mt-1 font-mono text-[11px]"
                  style={{ color: accent[plane.id] }}
                >
                  {plane.runtime}
                </div>
                <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                  {plane.blurb}
                </p>
              </div>
              <div className="flex flex-wrap content-start gap-2">
                {plane.nodes.map((node) => (
                  <NodeChip key={node}>{node}</NodeChip>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
