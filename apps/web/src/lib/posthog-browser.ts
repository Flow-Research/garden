import posthog from 'posthog-js'
import type { User, Workspace } from '@garden/core/types'
import {
  GARDEN_POSTHOG_GROUP_TYPE,
  resolveGardenAnalyticsEnvironment,
  type GardenAnalyticsEventName,
  type GardenAnalyticsProperties,
} from '@garden/observability/analytics/events'

const projectToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN
let authenticatedPageviewKey = ''

if (typeof window !== 'undefined' && projectToken && !posthog.__loaded) {
  posthog.init(projectToken, {
    api_host: `${window.location.origin}/ingest`,
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
    capture_exceptions: true,
    capture_pageview: false,
    disable_session_recording: true,
  })
  posthog.register({
    environment: resolveGardenAnalyticsEnvironment({
      hostname: window.location.hostname,
    }),
  })
}

export const postHogBrowserClient = posthog
export const isPostHogBrowserEnabled = Boolean(projectToken)

export function identifyPostHogUser(user: User) {
  if (!projectToken) return

  posthog.identify(user.id, {
    email: user.email,
    name: user.name,
    created_at: user.created_at,
    updated_at: user.updated_at,
  })
}

export function setPostHogWorkspace(workspace: Workspace | null) {
  if (!projectToken) return

  if (!workspace) {
    posthog.resetGroups()
    return
  }

  posthog.group(GARDEN_POSTHOG_GROUP_TYPE, workspace.id, {
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    issue_prefix: workspace.issue_prefix,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
  })
}

export function synchronizePostHogContext(
  user: User,
  workspace: Workspace | null,
) {
  identifyPostHogUser(user)
  setPostHogWorkspace(workspace)

  if (!workspace) return
  const nextPageviewKey = `${user.id}:${workspace.id}`
  if (authenticatedPageviewKey === nextPageviewKey) return

  authenticatedPageviewKey = nextPageviewKey
  posthog.set_config({ capture_pageview: 'history_change' })
  posthog.capture('$pageview')
}

export function capturePostHogBrowserEvent(
  event: GardenAnalyticsEventName,
  properties?: GardenAnalyticsProperties,
) {
  if (!projectToken) return
  posthog.capture(event, properties)
}

export function resetPostHogIdentity() {
  if (!projectToken) return
  authenticatedPageviewKey = ''
  posthog.reset()
}
