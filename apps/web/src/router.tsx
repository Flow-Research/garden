import {
  Link,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Router-level 404 renderer for unmatched app routes. TanStack was warning that
 * root not-found fell back to the generic `<p>Not Found</p>`, which made local
 * API/WS failures look like route rendering bugs. This keeps not-found UI
 * explicit and leaves API routes to return JSON through server handlers.
 * Reference checked: TanStack Router not-found docs for
 * `defaultNotFoundComponent`.
 */
function DefaultNotFoundComponent() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <section className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This route does not exist in Garden.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
        >
          Go home
        </Link>
      </section>
    </main>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: DefaultNotFoundComponent,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
