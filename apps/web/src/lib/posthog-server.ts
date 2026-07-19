import { Result } from 'better-result'
import {
  captureGardenAnalyticsEvent,
  captureGardenAnalyticsException,
  identifyGardenWorkspaceGroup,
  type GardenPostHogEnv,
} from '@garden/observability/analytics/client'
import type {
  GardenAnalyticsEvent,
  GardenWorkspaceGroup,
} from '@garden/observability/analytics/events'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import { appEnv, type AppEnv } from '@/lib/server/env'
import type { AppRequestContext } from '@/lib/server/context'

const analyticsLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'posthog',
})

type PostHogServerEnv = Pick<
  AppEnv,
  | 'ENVIRONMENT'
  | 'VITE_PUBLIC_POSTHOG_HOST'
  | 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN'
>

function postHogEnv(env: PostHogServerEnv): GardenPostHogEnv {
  return {
    ENVIRONMENT: env.ENVIRONMENT,
    VITE_PUBLIC_POSTHOG_HOST:
      env.VITE_PUBLIC_POSTHOG_HOST ?? import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN:
      env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ??
      import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
  }
}

function schedulePostHogCapture(
  waitUntil: AppRequestContext['waitUntil'],
  operation: string,
  capture: () => Promise<void>,
) {
  waitUntil(
    Result.tryPromise({
      try: capture,
      catch: (cause) => cause,
    }).then((result) => {
      if (result.isErr()) {
        analyticsLogger.warn('posthog.capture_failed', {
          operation,
          ...errorFields(result.error),
        })
      }
    }),
  )
}

export function capturePostHogEventWithScheduler(
  env: PostHogServerEnv,
  waitUntil: AppRequestContext['waitUntil'],
  input: GardenAnalyticsEvent,
) {
  schedulePostHogCapture(waitUntil, input.event, () =>
    captureGardenAnalyticsEvent(postHogEnv(env), input),
  )
}

export function capturePostHogEvent(
  context: AppRequestContext,
  input: GardenAnalyticsEvent,
) {
  capturePostHogEventWithScheduler(context.env, context.waitUntil, input)
}

export function identifyPostHogWorkspaceGroup(
  context: AppRequestContext,
  input: GardenWorkspaceGroup,
) {
  schedulePostHogCapture(context.waitUntil, '$groupidentify', () =>
    identifyGardenWorkspaceGroup(postHogEnv(context.env), input),
  )
}

type PostHogHandledError = {
  distinctId?: string
  error: unknown
  properties?: Record<string | number, unknown>
  workspaceId?: string
}

export function capturePostHogHandledErrorWithScheduler(
  env: PostHogServerEnv,
  waitUntil: AppRequestContext['waitUntil'],
  input: PostHogHandledError,
) {
  schedulePostHogCapture(waitUntil, '$exception', () =>
    captureGardenAnalyticsException(postHogEnv(env), input),
  )
}

export function capturePostHogHandledError(
  context: AppRequestContext,
  input: PostHogHandledError,
) {
  capturePostHogHandledErrorWithScheduler(context.env, context.waitUntil, input)
}

/** Captures a server exception through the edge-safe immediate API. */
export async function capturePostHogException(input: {
  error: unknown
  distinctId?: string
  properties?: Record<string | number, unknown>
  workspaceId?: string
}) {
  await captureGardenAnalyticsException(postHogEnv(appEnv), input)
}
