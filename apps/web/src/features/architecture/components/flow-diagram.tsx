import { cn } from '@garden/ui/lib/utils'

/**
 * Horizontal data-flow diagram: labelled nodes connected by animated arrows,
 * left→right, wrapping on narrow screens. Used to show request/data paths (a
 * chat turn, the prompt stack, etc.) at a glance. Motion is the dashed-arrow
 * flow only and is disabled under reduced-motion (see architecture.css).
 */
export type FlowNode = { label: string; tone?: 'default' | 'moss' | 'amber' }

const toneClass: Record<NonNullable<FlowNode['tone']>, string> = {
  default: 'text-foreground/90',
  moss: 'text-[color:var(--moss)]',
  amber: 'text-[color:var(--amber)]',
}

export function FlowDiagram({ nodes, className }: { nodes: FlowNode[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-1 gap-y-3', className)}>
      {nodes.map((node, i) => (
        <div key={`${node.label}-${i}`} className="flex items-center gap-1">
          <span
            className={cn(
              'arch-node whitespace-nowrap px-2.5 py-1.5 font-mono text-[12px]',
              toneClass[node.tone ?? 'default'],
            )}
          >
            {node.label}
          </span>
          {i < nodes.length - 1 && <FlowArrow />}
        </div>
      ))}
    </div>
  )
}

/** Short animated dashed arrow used between flow nodes. */
function FlowArrow() {
  return (
    <svg
      width="28"
      height="10"
      viewBox="0 0 28 10"
      fill="none"
      aria-hidden
      className="shrink-0 text-[color:var(--moss)]"
    >
      <line
        x1="0"
        y1="5"
        x2="22"
        y2="5"
        stroke="currentColor"
        strokeWidth="1.5"
        className="arch-edge-flow"
      />
      <path d="M22 1.5 L27 5 L22 8.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
