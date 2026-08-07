import { PostHog } from 'posthog-node/edge'
import {
  GARDEN_POSTHOG_GROUP_TYPE,
  resolveGardenAnalyticsEnvironment,
  type GardenAnalyticsEvent,
  type GardenWorkspaceGroup,
} from './events'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export type GardenPostHogEnv = {
  ENVIRONMENT?: string
  VITE_PUBLIC_POSTHOG_HOST?: string
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
}

function createPostHogClient(env: GardenPostHogEnv) {
  const token = env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
  if (!token) return null

  return new PostHog(token, {
    host: env.VITE_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    before_send: (event) => {
      if (!event) return null
      const workspaceId = event.properties?.workspace_id
      if (typeof workspaceId !== 'string') return event

      return {
        ...event,
        groups: {
          ...event.groups,
          [GARDEN_POSTHOG_GROUP_TYPE]: workspaceId,
        },
      }
    },
  })
}

/**
 * Captures one Garden product or AI event immediately from an edge runtime.
 * Cloudflare isolates have no durable process flush lifecycle, so callers must
 * schedule the returned promise with their request or Durable Object
 * `waitUntil`. Workspace membership is attached through PostHog's canonical
 * group map while environment remains a normal event property.
 */
export async function captureGardenAnalyticsEvent(
  env: GardenPostHogEnv,
  input: GardenAnalyticsEvent,
) {
  const posthog = createPostHogClient(env)
  if (!posthog) return

  await posthog.captureImmediate({
    distinctId: input.distinctId,
    event: input.event,
    ...(input.workspaceId
      ? { groups: { [GARDEN_POSTHOG_GROUP_TYPE]: input.workspaceId } }
      : {}),
    properties: {
      source: 'garden',
      environment: resolveGardenAnalyticsEnvironment({
        environment: env.ENVIRONMENT,
      }),
      user_id: input.distinctId,
      ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
      ...input.properties,
    },
    timestamp: input.timestamp,
    uuid: input.uuid,
  })
}

/**
 * Creates or updates Garden's workspace group through the same immediate edge
 * transport used for product events. `posthog-node` currently exposes queued
 * `groupIdentify` only, so this emits its documented `$groupidentify` payload
 * directly and keeps the operation safe for short-lived Workers and DO turns.
 */
export async function identifyGardenWorkspaceGroup(
  env: GardenPostHogEnv,
  input: GardenWorkspaceGroup,
) {
  const posthog = createPostHogClient(env)
  if (!posthog) return

  await posthog.captureImmediate({
    distinctId: input.distinctId ?? `${GARDEN_POSTHOG_GROUP_TYPE}:${input.id}`,
    event: '$groupidentify',
    properties: {
      $group_type: GARDEN_POSTHOG_GROUP_TYPE,
      $group_key: input.id,
      $group_set: input.properties,
      environment: resolveGardenAnalyticsEnvironment({
        environment: env.ENVIRONMENT,
      }),
    },
  })
}

/** Captures an exception immediately while preserving workspace attribution. */
export async function captureGardenAnalyticsException(
  env: GardenPostHogEnv,
  input: {
    distinctId?: string
    error: unknown
    properties?: Record<string | number, unknown>
    workspaceId?: string
  },
) {
  const posthog = createPostHogClient(env)
  if (!posthog) return

  await posthog.captureExceptionImmediate(input.error, input.distinctId, {
    environment: resolveGardenAnalyticsEnvironment({
      environment: env.ENVIRONMENT,
    }),
    ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
    ...input.properties,
  })
}
