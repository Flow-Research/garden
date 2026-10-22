import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { Button, buttonVariants } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { ApiError } from '@/lib/api/errors'

/**
 * Route-level fallback for the Teams surfaces. A 403/404 from the Team access
 * helpers means "not yours or gone", so members hitting an admin URL (or a
 * deleted Team) get an explanation instead of the shell-wide error panel.
 */
export function TeamRouteError({ error, reset }: ErrorComponentProps) {
  const inaccessible =
    error instanceof ApiError && (error.status === 403 || error.status === 404)

  return (
    <main className="grid min-h-0 flex-1 place-items-center px-6 py-16">
      <section className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          {inaccessible ? 'Team unavailable' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-text-secondary">
          {inaccessible
            ? "This Team doesn't exist, was deleted, or you don't have access to it."
            : 'The Teams view failed to load. Retry, or head back to the overview.'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" onClick={reset}>
            Retry
          </Button>
          <Link className={cn(buttonVariants())} to="/teams">
            Back to Teams
          </Link>
        </div>
      </section>
    </main>
  )
}
