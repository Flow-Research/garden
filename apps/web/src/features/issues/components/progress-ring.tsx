import { cn } from '@garden/ui/lib/utils'

/** Compact progress indicator built from a conic fill and an inset surface. */
export function ProgressRing({
  done,
  total,
  size = 12,
}: {
  done: number
  total: number
  size?: number
}) {
  const fraction = total > 0 ? Math.min(Math.max(done / total, 0), 1) : 0
  const complete = total > 0 && done >= total

  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(done, total)}
      className={cn(
        'relative inline-grid shrink-0 place-items-center rounded-full',
        complete ? 'text-info' : 'text-primary',
      )}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(currentColor ${fraction * 360}deg, color-mix(in oklch, currentColor 20%, transparent) 0deg)`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute rounded-full bg-background"
        style={{ inset: 1.5 }}
      />
    </span>
  )
}
