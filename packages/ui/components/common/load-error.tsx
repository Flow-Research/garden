import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

export interface LoadErrorProps {
  /** What failed, e.g. "Could not load comments." */
  message: string
  onRetry: () => void
  /** True while the retry runs; disables the button. */
  retrying?: boolean
  className?: string
}

/**
 * A failed load, said as such, with a way to try again. Use it instead of
 * falling through to an empty state, which tells the user there is nothing
 * there when the request only failed.
 */
export function LoadError({
  message,
  onRetry,
  retrying = false,
  className,
}: LoadErrorProps) {
  return (
    <div className={cn('flex items-center gap-3 text-sm', className)}>
      <p role="alert" className="text-text-danger-secondary">
        {message}
      </p>
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Trying…' : 'Try again'}
      </Button>
    </div>
  )
}
