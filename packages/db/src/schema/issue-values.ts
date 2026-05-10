export const issueStatusValues = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
] as const

export const issuePriorityValues = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const

export const issueDbAssigneeTypeValues = ['user', 'agent'] as const
export const issueCommentAuthorTypeValues = ['user', 'agent'] as const

export const connectorIdValues = [
  'github',
  'slack',
  'gmail',
  'google_drive',
  'exa_search',
  'manual',
  'agent',
] as const

export const sourceKindValues = [
  'issue',
  'pull_request',
  'message',
  'thread',
  'email_thread',
  'file',
  'search_result',
] as const

export const issueWakeupSourceValues = [
  'assignment',
  'comment',
  'mention',
  'manual',
  'scheduled',
  'automation',
  'connector_event',
  'reconciler_retry',
  'hire_approval',
] as const

export const issueWakeupStatusValues = [
  'pending',
  'claimed',
  'completed',
  'failed',
  'superseded',
] as const

export const activeIssueWakeupStatusValues = ['pending', 'claimed'] as const

export const issueRunStatusValues = [
  'queued',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
] as const

export const activeIssueRunStatusValues = [
  'queued',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
] as const

export const issueRunTriggerSourceValues = [
  'schedule',
  'manual',
  'webhook',
  'api',
  'chat',
  'sub_agent',
  'comment',
  'mention',
  'assignment',
  'connector_event',
  'reconciler_retry',
  'hire_approval',
  'automation',
] as const

export const issueRunEventTypeValues = [
  'issue_run:queued',
  'issue_run:started',
  'issue_run:message',
  'issue_run:tool_started',
  'issue_run:tool_finished',
  'issue_run:work_product_created',
  'issue_run:source_binding_added',
  'issue_run:input_requested',
  'issue_run:approval_requested',
  'issue_run:blocked',
  'issue_run:succeeded',
  'issue_run:failed',
  'issue_run:cancelled',
  'issue_run:reconciler_action',
] as const

export const issueRunEventStreamValues = [
  'system',
  'agent',
  'tool',
  'connector',
] as const

export const issueRunEventLevelValues = ['info', 'warn', 'error'] as const

export const issueWorkProductTypeValues = [
  'brief',
  'plan',
  'connector_reply',
  'pull_request',
  'report',
  'checklist',
] as const

export const issueWorkProductStatusValues = [
  'draft',
  'review',
  'approved',
  'applied',
  'superseded',
] as const

export const issueWorkProductReviewStateValues = [
  'pending',
  'approved',
  'changes_requested',
] as const

export const inboxRecipientTypeValues = ['member', 'agent'] as const
export const inboxActorTypeValues = ['member', 'agent'] as const
export const inboxSeverityValues = [
  'action_required',
  'attention',
  'info',
] as const
