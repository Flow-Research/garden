import { useState } from 'react'
import { cn } from '@garden/ui/lib/utils'
import { flows } from '../architecture-copy'

/**
 * Run-lifecycle viewer. Tabs switch between issue / automation / chat flows; the
 * selected flow renders as a vertical stepper with a single moss pulse
 * travelling the rail top→bottom (CSS only, disabled under reduced-motion).
 *
 * Layout note: each step uses a fixed-width (24px) dot column and the rail is
 * absolutely positioned at that column's center (left-3 = 12px), so dot and rail
 * stay aligned at every breakpoint without measuring the DOM. The pulse animates
 * `top` 0→100% of the rail, so it spans any number of steps.
 */
export function LifecycleFlow() {
  const [active, setActive] = useState(flows[0].id)
  const flow = flows.find((f) => f.id === active) ?? flows[0]

  return (
    <div>
      <div className="mb-5 inline-flex rounded-lg border border-[color:var(--hairline)] bg-[color:var(--parchment-deep)] p-1">
        {flows.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActive(f.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              f.id === active
                ? 'bg-[color:var(--bone)] text-foreground shadow-[var(--shadow-hairline)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mb-6 max-w-xl text-[13px] leading-6 text-muted-foreground">
        {flow.summary}
      </p>

      <div className="arch-card p-6">
        <div className="relative">
          {/* Rail + travelling pulse, centered on the 24px dot column (left-3 = 12px). */}
          <div
            className="arch-flow-rail absolute bottom-3 left-3 top-3 w-px"
            aria-hidden
          >
            <span className="arch-flow-pulse" />
          </div>

          <ol className="relative space-y-5">
            {flow.steps.map((step, i) => (
              <li
                key={`${flow.id}-${i}`}
                className="grid grid-cols-[24px_1fr] items-start gap-3"
              >
                <div className="flex justify-center pt-1.5">
                  <span
                    className="arch-node-dot size-2.5 rounded-full border border-[color:var(--moss)] bg-[color:var(--parchment-solid)]"
                    style={{
                      animationDelay: `${(i / flow.steps.length) * 3.6}s`,
                    }}
                    aria-hidden
                  />
                </div>
                <div>
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--amber)]">
                      {step.actor}
                    </span>
                    <span className="font-mono text-[13px] text-foreground">
                      {step.title}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
