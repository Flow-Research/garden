import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

/**
 * Returns a singleton PostHog Node.js client for server-side event capture.
 * flushAt:1 + flushInterval:0 ensures each event is dispatched immediately,
 * which is required in Cloudflare Workers where the isolate may terminate
 * before a periodic flush fires. Always await posthog.flush() after capture.
 */
export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    posthogClient = new PostHog(
      import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!,
      {
        host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
      },
    )
  }
  return posthogClient
}
