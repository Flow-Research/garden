import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@garden/ui/components/ui/button'

/**
 * Default route error: rendered in place of the route that failed, so a page
 * error inside the app shell keeps the sidebar and top bar. Without a default,
 * errors bubbled to the authenticated layout's boundary, above the shell, and
 * replaced the whole app. Retry also resets failed suspense queries and
 * reloads the route.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const queryErrorReset = useQueryErrorResetBoundary()

  const retry = () => {
    queryErrorReset.reset()
    reset()
    void router.invalidate()
  }

  return (
    <section
      role="alert"
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <h2 className="text-base font-semibold text-foreground">
        This page could not be loaded
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong while showing it. Try again, or refresh if it keeps
        happening.
      </p>
      {import.meta.env.DEV ? (
        <p className="max-w-md rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
          {error.message}
        </p>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={retry}>
        Try again
      </Button>
    </section>
  )
}
