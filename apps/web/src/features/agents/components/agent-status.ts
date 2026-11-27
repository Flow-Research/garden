import type { Agent } from '@garden/core/types'

/** Status-dot fill per agent status, shared by the agents list and detail. */
export const AGENT_STATUS_COLOR: Record<Agent['status'], string> = {
  idle: 'bg-icon-tertiary',
  working: 'bg-background-success-default',
  blocked: 'bg-background-warning-default',
  error: 'bg-background-danger-default',
  offline: 'bg-background-main-tertiary',
}
