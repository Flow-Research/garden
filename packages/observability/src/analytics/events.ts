export const GARDEN_POSTHOG_GROUP_TYPE = 'workspace' as const

export type GardenAnalyticsEnvironment =
  | 'development'
  | 'test'
  | 'staging'
  | 'production'

const GARDEN_ANALYTICS_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'development',
  'test',
  'staging',
  'production',
])

export function resolveGardenAnalyticsEnvironment(input: {
  environment?: string
  hostname?: string
}): GardenAnalyticsEnvironment {
  if (
    input.environment &&
    GARDEN_ANALYTICS_ENVIRONMENTS.has(input.environment)
  ) {
    return input.environment as GardenAnalyticsEnvironment
  }
  if (!input.hostname) return 'development'
  if (input.hostname === 'localhost' || input.hostname === '127.0.0.1') {
    return 'development'
  }
  return input.hostname.includes('staging') ||
    input.hostname.includes('preview')
    ? 'staging'
    : 'production'
}

export const GARDEN_ANALYTICS_EVENTS = {
  userSignedIn: 'user_signed_in',
  userSignedUp: 'user_signed_up',
  workspaceCreated: 'workspace_created',
  agentCreated: 'agent_created',
  skillImported: 'skill_imported',
  toolPermissionGranted: 'tool_permission_granted',
  connectorConnectionStarted: 'connector_connection_started',
  connectorConnectionCompleted: 'connector_connection_completed',
  connectorConnected: 'connector_connected',
  connectorConnectionFailed: 'connector_connection_failed',
  connectorDisconnected: 'connector_disconnected',
  connectorDisconnectFailed: 'connector_disconnect_failed',
  connectorResyncCompleted: 'connector_resync_completed',
  chatThreadCreated: 'chat_thread_created',
  chatThreadReopened: 'chat_thread_reopened',
  chatMessageSent: 'chat_message_sent',
  chatResponseCompleted: 'chat_response_completed',
  chatResponseFailed: 'chat_response_failed',
  issueCreated: 'issue_created',
  issueRunStarted: 'issue_run_started',
  issueRunWaiting: 'issue_run_waiting',
  issueRunCompleted: 'issue_run_completed',
  issueRunFailed: 'issue_run_failed',
  issueRunCancelled: 'issue_run_cancelled',
  approvalRequested: 'approval_requested',
  approvalResolved: 'approval_resolved',
  workProductSubmitted: 'work_product_submitted',
  workProductReviewed: 'work_product_reviewed',
  automationCreated: 'automation_created',
  automationTriggered: 'automation_triggered',
  automationRunStarted: 'automation_run_started',
  automationRunCompleted: 'automation_run_completed',
  automationRunFailed: 'automation_run_failed',
  automationRunSkipped: 'automation_run_skipped',
  automationRunCancelled: 'automation_run_cancelled',
  aiTrace: '$ai_trace',
  aiGeneration: '$ai_generation',
  aiSpan: '$ai_span',
  aiFeedback: '$ai_feedback',
  aiMetric: '$ai_metric',
} as const

export type GardenAnalyticsEventName =
  (typeof GARDEN_ANALYTICS_EVENTS)[keyof typeof GARDEN_ANALYTICS_EVENTS]

export type GardenAnalyticsProperties = Record<string, unknown>

export type GardenAnalyticsEvent = {
  distinctId: string
  event: GardenAnalyticsEventName
  properties?: GardenAnalyticsProperties
  timestamp?: Date
  uuid?: string
  workspaceId?: string
}

export type GardenWorkspaceGroup = {
  distinctId?: string
  id: string
  properties: GardenAnalyticsProperties
}
