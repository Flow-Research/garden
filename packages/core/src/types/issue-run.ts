import type {
  issueRunEventLevelSchema,
  issueRunEventStreamSchema,
  issueRunEventTypeSchema,
  issueRunSelectSchema,
  issueRunStatusSchema,
} from '@garden/db/validation'
import type { z } from 'zod'

export type IssueRunStatus = z.infer<typeof issueRunStatusSchema>
export type IssueRunEventType = z.infer<typeof issueRunEventTypeSchema>
export type IssueRunEventStream = z.infer<typeof issueRunEventStreamSchema>
export type IssueRunEventLevel = z.infer<typeof issueRunEventLevelSchema>

export type IssueRunRecord = z.infer<typeof issueRunSelectSchema>

export interface IssueRunUsage {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens?: number
  total_tokens: number
  model: string
  model_provider: string
  step_count: number
  recorded_at_ms: number
}

export type IssueRunTriggerSource =
  | 'schedule'
  | 'manual'
  | 'webhook'
  | 'api'
  | 'chat'
  | 'sub_agent'
  | 'comment'
  | 'mention'
  | 'assignment'
  | 'connector_event'
  | 'reconciler_retry'
  | 'hire_approval'

export interface IssueRun {
  id: string
  workspace_id: string
  issue_id: string
  agent_id: string
  host_name: string
  status: IssueRunStatus
  trigger_source: IssueRunTriggerSource | null
  trigger_ref: Record<string, unknown> | null
  parent_run_id: string | null
  workflow_instance_id: string | null
  cancel_requested_at: string | null
  context_snapshot?: Record<string, unknown> | null
  result_json?: Record<string, unknown> | null
  usage_json?: Record<string, unknown> | null
  usage: IssueRunUsage | null
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface IssueRunEvent {
  id: string
  workspace_id: string
  issue_id: string
  run_id: string
  seq: number
  event_type: IssueRunEventType
  stream: IssueRunEventStream
  level: IssueRunEventLevel
  message: string | null
  payload: Record<string, unknown> | null
  created_at: string
}
