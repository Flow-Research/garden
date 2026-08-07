import type {
  issueSourceBindingSelectSchema,
  issueWorkProductReviewStateSchema,
  issueWorkProductSelectSchema,
  issueWorkProductStatusSchema,
  issueWorkProductTypeSchema,
} from '@garden/db/validation'
import type { z } from 'zod'

export type IssueWorkProductType = z.infer<typeof issueWorkProductTypeSchema>
export type IssueWorkProductStatus = z.infer<
  typeof issueWorkProductStatusSchema
>
export type IssueWorkProductReviewState = z.infer<
  typeof issueWorkProductReviewStateSchema
>

export type IssueWorkProductRecord = z.infer<
  typeof issueWorkProductSelectSchema
>
export type IssueSourceBindingRecord = z.infer<
  typeof issueSourceBindingSelectSchema
>

export interface IssueWorkProduct {
  id: string
  workspace_id: string
  issue_id: string
  run_id: string | null
  agent_id: string | null
  type: IssueWorkProductType
  status: IssueWorkProductStatus
  review_state: IssueWorkProductReviewState
  is_primary: boolean
  title: string
  body: string
  payload: Record<string, unknown> | null
  applied_at: string | null
  applied_external_id: string | null
  applied_external_url: string | null
  previous_versions_count: number
  created_at: string
  updated_at: string
}

export interface IssueSourceBinding {
  id: string
  workspace_id: string
  issue_id: string
  connector_id: string
  source_kind: string
  external_id: string
  external_url: string | null
  display_ref: string | null
  title_snapshot: string | null
  metadata: Record<string, unknown> | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}
