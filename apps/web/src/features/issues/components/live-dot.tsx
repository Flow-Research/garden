'use client'

import { cn } from '@garden/ui/lib/utils'

type LiveDotVariant = 'queued' | 'running' | 'waiting' | 'blocked' | 'failed' | 'succeeded'

interface LiveDotProps {
  variant?: LiveDotVariant
  className?: string
  /** When true, shows the pulse animation. Defaults to true for queued/running/waiting. */
  pulse?: boolean
}

const variantClass: Record<LiveDotVariant, string> = {
  queued: 'bg-muted-foreground/60',
  running: 'bg-info',
  waiting: 'bg-warning',
  blocked: 'bg-destructive',
  failed: 'bg-destructive/60',
  succeeded: 'bg-success',
}

const animatesByDefault: Record<LiveDotVariant, boolean> = {
  queued: true,
  running: true,
  waiting: true,
  blocked: false,
  failed: false,
  succeeded: false,
}

export function LiveDot({
  variant = 'running',
  className,
  pulse,
}: LiveDotProps) {
  const shouldPulse = pulse ?? animatesByDefault[variant]
  return (
    <span
      aria-label={`status: ${variant}`}
      className={cn(
        'relative inline-flex h-1.5 w-1.5 shrink-0 items-center justify-center',
        className,
      )}
    >
      {shouldPulse && (
        <span
          className={cn(
            'absolute inset-0 m-auto h-1.5 w-1.5 rounded-full opacity-75 animate-ping',
            variantClass[variant],
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex h-1.5 w-1.5 rounded-full',
          variantClass[variant],
        )}
      />
    </span>
  )
}
