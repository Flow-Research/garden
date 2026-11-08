import type { Reaction } from './comment'
import type { Attachment } from './attachment'
import type { IssueRunEvent } from './issue-run'

export interface AssigneeFrequencyEntry {
  assignee_type: string
  assignee_id: string
  frequency: number
}

export interface TimelineEntry {
  type: 'activity' | 'comment' | 'run_event'
  id: string
  actor_type: string
  actor_id: string | null
  /** Override actor name for connector-sourced comments (`GitHub · @login`). */
  actor_label?: string | null
  created_at: string
  event?: IssueRunEvent
  // Activity fields
  action?: string
  details?: Record<string, unknown>
  // Comment fields
  content?: string
  parent_id?: string | null
  updated_at?: string
  comment_type?: string
  reactions?: Reaction[]
  attachments?: Attachment[]
}
