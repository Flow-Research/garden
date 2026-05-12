import { ApiError } from './errors'
import { getApiTransport } from './state'

export type AutomationStatus = 'active' | 'paused' | 'archived'
export type AutomationPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'
export type AutomationConcurrencyPolicy = 'skip' | 'queue' | 'replace'
export type AutomationRunSource = 'schedule' | 'manual' | 'webhook' | 'api'
export type AutomationRunStatus =
  | 'pending'
  | 'issue_created'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type Automation = {
  id: string
  workspace_id: string
  project_id: string | null
  title: string
  description: string | null
  issue_title_template: string | null
  assignee_agent_id: string
  priority: AutomationPriority
  status: AutomationStatus
  concurrency_policy: AutomationConcurrencyPolicy
  last_run_at: string | null
  created_by: string
  created_at: string | null
  updated_at: string | null

  system_prompt: string | null
  input_schema: unknown
  context_sources: unknown
  output_config: unknown
  execution_config: unknown
  notification_config: unknown
  scheduling_config: unknown
  tags: string[]
  category: string | null
  template_source: string | null
  next_run_at: string | null
  run_count: number
  success_count: number
  failure_count: number
  skip_count: number
  avg_duration_ms: number | null
  updated_by: string | null
  metadata: unknown
}

export type AutomationListItem = Pick<
  Automation,
  'id' | 'title' | 'assignee_agent_id' | 'status' | 'last_run_at'
> & {
  assignee_agent_name: string | null
}

export type AutomationTrigger = {
  id: string
  automation_id: string
  kind: 'schedule' | 'webhook' | 'api'
  enabled: boolean
  label: string | null
  cron_expression: string | null
  timezone: string | null
  next_run_at: string | null
  last_fired_at: string | null
  created_at: string | null
  updated_at: string | null
}

export type AutomationRun = {
  id: string
  automation_id: string
  trigger_id: string | null
  source: AutomationRunSource
  status: AutomationRunStatus
  issue_id: string | null
  issue_run_id: string | null
  triggered_at: string | null
  completed_at: string | null
  failure_reason: string | null
  trigger_payload: unknown
  created_at: string | null
}

export type AutomationListResponse = {
  automations: AutomationListItem[]
}

export type AutomationDetailResponse = {
  automation: Automation
  triggers: AutomationTrigger[]
  runs: AutomationRun[]
}

export type CreateAutomationRequest = {
  title: string
  description?: string | null
  issue_title_template?: string | null
  assignee_agent_id: string
  priority?: AutomationPriority
  project_id?: string | null
  status?: AutomationStatus
  concurrency_policy?: AutomationConcurrencyPolicy
  trigger?: CreateAutomationTriggerRequest

  system_prompt?: string | null
  input_schema?: unknown
  context_sources?: unknown
  output_config?: unknown
  execution_config?: unknown
  notification_config?: unknown
  scheduling_config?: unknown
  tags?: string[]
  category?: string | null
  template_source?: string | null
  metadata?: unknown
}

export type UpdateAutomationRequest = Partial<
  Pick<
    CreateAutomationRequest,
    | 'title'
    | 'description'
    | 'issue_title_template'
    | 'assignee_agent_id'
    | 'priority'
    | 'project_id'
    | 'status'
    | 'concurrency_policy'
    | 'system_prompt'
    | 'input_schema'
    | 'context_sources'
    | 'output_config'
    | 'execution_config'
    | 'notification_config'
    | 'scheduling_config'
    | 'tags'
    | 'category'
    | 'template_source'
    | 'metadata'
  >
>

export type CreateAutomationTriggerRequest = {
  kind?: 'schedule'
  label?: string | null
  enabled?: boolean
  cron_expression: string
  timezone: string
}

export type UpdateAutomationTriggerRequest = {
  label?: string | null
  enabled?: boolean
  cron_expression?: string
  timezone?: string
}

type ApiEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message: string } }

function unwrapAutomationEnvelope<T>(payload: ApiEnvelope<T>): T {
  if (payload.ok) return payload.value
  throw new ApiError({
    message: payload.error.message,
    status: 400,
    statusText: payload.error.code ?? 'Automation Error',
  })
}

export async function listAutomations(params?: {
  status?: AutomationStatus
  limit?: number
  offset?: number
}): Promise<AutomationListResponse> {
  const search = new URLSearchParams()
  if (params?.status) search.set('status', params.status)
  if (params?.limit !== undefined) search.set('limit', String(params.limit))
  if (params?.offset !== undefined) search.set('offset', String(params.offset))
  const suffix = search.size > 0 ? `?${search}` : ''
  const payload = await getApiTransport().request<
    ApiEnvelope<AutomationListResponse>
  >(`/api/automations${suffix}`)
  return unwrapAutomationEnvelope(payload)
}

export async function getAutomation(
  id: string,
): Promise<AutomationDetailResponse> {
  const payload = await getApiTransport().request<
    ApiEnvelope<AutomationDetailResponse>
  >(`/api/automations/${id}`)
  return unwrapAutomationEnvelope(payload)
}

export async function createAutomation(
  data: CreateAutomationRequest,
): Promise<{ automation: Automation; trigger: AutomationTrigger | null }> {
  const payload = await getApiTransport().request<
    ApiEnvelope<{ automation: Automation; trigger: AutomationTrigger | null }>
  >('/api/automations', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return unwrapAutomationEnvelope(payload)
}

export async function updateAutomation(
  id: string,
  data: UpdateAutomationRequest,
): Promise<Automation> {
  const payload = await getApiTransport().request<ApiEnvelope<Automation>>(
    `/api/automations/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  )
  return unwrapAutomationEnvelope(payload)
}

export async function deleteAutomation(id: string): Promise<Automation> {
  const payload = await getApiTransport().request<ApiEnvelope<Automation>>(
    `/api/automations/${id}`,
    { method: 'DELETE' },
  )
  return unwrapAutomationEnvelope(payload)
}

export async function triggerAutomation(id: string): Promise<AutomationRun> {
  const payload = await getApiTransport().request<ApiEnvelope<AutomationRun>>(
    `/api/automations/${id}/trigger`,
    {
      method: 'POST',
      body: JSON.stringify({ source: 'manual' }),
    },
  )
  return unwrapAutomationEnvelope(payload)
}

export async function listAutomationRuns(id: string): Promise<AutomationRun[]> {
  const payload = await getApiTransport().request<ApiEnvelope<AutomationRun[]>>(
    `/api/automations/${id}/runs`,
  )
  return unwrapAutomationEnvelope(payload)
}

export async function createAutomationTrigger(
  automationId: string,
  data: CreateAutomationTriggerRequest,
): Promise<AutomationTrigger> {
  const payload = await getApiTransport().request<
    ApiEnvelope<AutomationTrigger>
  >(`/api/automations/${automationId}/triggers`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return unwrapAutomationEnvelope(payload)
}

export async function updateAutomationTrigger(
  automationId: string,
  triggerId: string,
  data: UpdateAutomationTriggerRequest,
): Promise<AutomationTrigger> {
  const payload = await getApiTransport().request<
    ApiEnvelope<AutomationTrigger>
  >(`/api/automations/${automationId}/triggers/${triggerId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return unwrapAutomationEnvelope(payload)
}

export async function deleteAutomationTrigger(
  automationId: string,
  triggerId: string,
): Promise<AutomationTrigger> {
  const payload = await getApiTransport().request<
    ApiEnvelope<AutomationTrigger>
  >(`/api/automations/${automationId}/triggers/${triggerId}`, {
    method: 'DELETE',
  })
  return unwrapAutomationEnvelope(payload)
}
