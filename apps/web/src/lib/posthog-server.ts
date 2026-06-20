import { PostHog } from 'posthog-node/edge'
import { appEnv } from '@/lib/server/env'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

function postHogProjectToken() {
  return (
    appEnv.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ??
    import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ??
    ''
  )
}

function postHogHost() {
  return (
    appEnv.VITE_PUBLIC_POSTHOG_HOST ??
    import.meta.env.VITE_PUBLIC_POSTHOG_HOST ??
    DEFAULT_POSTHOG_HOST
  )
}

/**
 * Creates a Cloudflare Workers-safe PostHog client. PostHog's Workers docs say
 * `posthog-node` ships a dedicated workerd/edge export that avoids Node builtins
 * and recommend per-request clients because isolates have no flush lifecycle.
 * Before this change Garden imported the Node entry and reused a singleton;
 * after this change server captures use the edge entry with immediate flushing.
 * References: PostHog Cloudflare Workers docs and error-tracking Node docs.
 */
export function getPostHogClient(): PostHog {
  return new PostHog(postHogProjectToken(), {
    host: postHogHost(),
    flushAt: 1,
    flushInterval: 0,
  })
}

/**
 * Captures a server exception through the Cloudflare-safe immediate API. This
 * exists because PostHog's error-tracking docs recommend `captureException`,
 * while Workers docs require immediate capture for short-lived isolates. Before
 * this helper, worker-boundary errors were only logged; after it, they also land
 * in PostHog Error Tracking when `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` is set.
 */
export async function capturePostHogException(input: {
  error: unknown
  distinctId?: string
  properties?: Record<string | number, unknown>
}) {
  const posthog = getPostHogClient()
  await posthog.captureExceptionImmediate(
    input.error,
    input.distinctId,
    input.properties,
  )
}
