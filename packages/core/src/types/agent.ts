import type { agentSelectSchema } from '@garden/db/validation'
import type { Skill } from '../skills/effect-schemas'
import type { z } from 'zod'

export type {
  AgentSkill,
  AgentSkillAssignment,
  CreateSkillRequest,
  SetAgentSkillsRequest,
  Skill,
  SkillFile,
  SkillPreview,
  SkillsShSearchResult,
  UpdateSkillRequest,
} from '../skills/effect-schemas'

export type AgentRecord = z.infer<typeof agentSelectSchema>
export type AgentRecordStatus = AgentRecord['status']

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'error' | 'offline'

export type AgentRuntimeMode = 'local' | 'cloud'

export type AgentVisibility = 'workspace' | 'private'

export interface Agent {
  id: string
  workspace_id: string
  reports_to?: string | null
  runtime_id: string
  name: string
  description: string
  instructions: string
  avatar_url: string | null
  runtime_mode: AgentRuntimeMode
  runtime_config: Record<string, unknown>
  custom_env: Record<string, string>
  custom_args: string[]
  custom_env_redacted: boolean
  visibility: AgentVisibility
  status: AgentStatus
  record_status: AgentRecordStatus
  is_default: AgentRecord['isDefault']
  max_concurrent_tasks: number
  owner_id: string | null
  skills: Skill[]
  created_at: string
  updated_at: string
  archived_at: string | null
  archived_by: string | null
}

export interface CreateAgentRequest {
  name: string
  description?: string
  reports_to?: string | null
  instructions?: string
  avatar_url?: string
  runtime_id: string
  runtime_config?: Record<string, unknown>
  custom_env?: Record<string, string>
  custom_args?: string[]
  visibility?: AgentVisibility
  max_concurrent_tasks?: number
}

export interface UpdateAgentRequest {
  name?: string
  description?: string
  reports_to?: string | null
  instructions?: string
  avatar_url?: string
  runtime_id?: string
  runtime_config?: Record<string, unknown>
  custom_env?: Record<string, string>
  custom_args?: string[]
  visibility?: AgentVisibility
  status?: AgentStatus
  max_concurrent_tasks?: number
}

// Skills are schema-derived from ../skills/effect-schemas.ts.

export type RuntimePingStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'

export interface RuntimePing {
  id: string
  runtime_id: string
  status: RuntimePingStatus
  output?: string
  error?: string
  duration_ms?: number
  created_at: string
  updated_at: string
}

export interface IssueUsageSummary {
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_write_tokens: number
  task_count: number
}

export interface RuntimeUsage {
  runtime_id: string
  date: string
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface RuntimeHourlyActivity {
  hour: number
  count: number
}

export type RuntimeUpdateStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'

export interface RuntimeUpdate {
  id: string
  runtime_id: string
  status: RuntimeUpdateStatus
  target_version: string
  output?: string
  error?: string
  created_at: string
  updated_at: string
}
