import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  inboxDismissal,
  issueRecurrence,
  issueRun,
  issueRunEvent,
  issueSourceBinding,
  issueWakeup,
  issueWorkProduct,
} from '../schema/index.js'

const uuidSchema = z.string().uuid()
const jsonObjectSchema = z.record(z.string(), z.unknown())

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
export const issueRunStatusSchema = z.enum(issueRunStatusValues)

export const issueWakeupStatusValues = [
  'pending',
  'claimed',
  'completed',
  'failed',
  'superseded',
] as const
export const issueWakeupStatusSchema = z.enum(issueWakeupStatusValues)

export const issueWakeupSourceValues = [
  'assignment',
  'comment',
  'mention',
  'manual',
  'scheduled',
  'connector_event',
  'reconciler_retry',
  'hire_approval',
] as const
export const issueWakeupSourceSchema = z.enum(issueWakeupSourceValues)

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
export const issueRunEventTypeSchema = z.enum(issueRunEventTypeValues)

export const issueRunEventStreamValues = [
  'system',
  'agent',
  'tool',
  'connector',
] as const
export const issueRunEventStreamSchema = z.enum(issueRunEventStreamValues)

export const issueRunEventLevelValues = ['info', 'warn', 'error'] as const
export const issueRunEventLevelSchema = z.enum(issueRunEventLevelValues)

export const issueWorkProductTypeValues = [
  'brief',
  'plan',
  'connector_reply',
  'pull_request',
  'report',
  'checklist',
] as const
export const issueWorkProductTypeSchema = z.enum(issueWorkProductTypeValues)

export const issueWorkProductStatusValues = [
  'draft',
  'review',
  'approved',
  'applied',
  'superseded',
] as const
export const issueWorkProductStatusSchema = z.enum(
  issueWorkProductStatusValues,
)

export const issueWorkProductReviewStateValues = [
  'pending',
  'approved',
  'changes_requested',
] as const
export const issueWorkProductReviewStateSchema = z.enum(
  issueWorkProductReviewStateValues,
)

export const connectorIdValues = [
  'github',
  'slack',
  'gmail',
  'google_drive',
  'exa_search',
  'manual',
  'agent',
] as const
export const connectorIdSchema = z.enum(connectorIdValues)

export const sourceKindValues = [
  'issue',
  'pull_request',
  'message',
  'thread',
  'email_thread',
  'file',
  'search_result',
] as const
export const sourceKindSchema = z.enum(sourceKindValues)

export const issueRunSelectSchema = createSelectSchema(issueRun, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  wakeupId: () => uuidSchema,
  status: () => issueRunStatusSchema,
  contextSnapshot: () => jsonObjectSchema,
  resultJson: () => jsonObjectSchema,
  usageJson: () => jsonObjectSchema,
})

export const issueRunInsertSchema = createInsertSchema(issueRun, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  wakeupId: () => uuidSchema,
  status: () => issueRunStatusSchema,
  contextSnapshot: () => jsonObjectSchema,
  resultJson: () => jsonObjectSchema,
  usageJson: () => jsonObjectSchema,
})

export const issueRunUpdateSchema = createUpdateSchema(issueRun, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  wakeupId: () => uuidSchema,
  status: () => issueRunStatusSchema,
  contextSnapshot: () => jsonObjectSchema,
  resultJson: () => jsonObjectSchema,
  usageJson: () => jsonObjectSchema,
})

export const issueRunEventSelectSchema = createSelectSchema(issueRunEvent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  runId: () => uuidSchema,
  eventType: () => issueRunEventTypeSchema,
  stream: () => issueRunEventStreamSchema,
  level: () => issueRunEventLevelSchema,
  payload: () => jsonObjectSchema,
})

export const issueRunEventInsertSchema = createInsertSchema(issueRunEvent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  runId: () => uuidSchema,
  eventType: () => issueRunEventTypeSchema,
  stream: () => issueRunEventStreamSchema,
  level: () => issueRunEventLevelSchema,
  payload: () => jsonObjectSchema,
})

export const issueWakeupSelectSchema = createSelectSchema(issueWakeup, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  triggerCommentId: () => uuidSchema,
  triggerSourceId: () => uuidSchema,
  source: () => issueWakeupSourceSchema,
  status: () => issueWakeupStatusSchema,
})

export const issueWakeupInsertSchema = createInsertSchema(issueWakeup, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  triggerCommentId: () => uuidSchema,
  triggerSourceId: () => uuidSchema,
  source: () => issueWakeupSourceSchema,
  status: () => issueWakeupStatusSchema,
})

export const issueWorkProductSelectSchema = createSelectSchema(issueWorkProduct, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  runId: () => uuidSchema,
  agentId: () => uuidSchema,
  type: () => issueWorkProductTypeSchema,
  status: () => issueWorkProductStatusSchema,
  reviewState: () => issueWorkProductReviewStateSchema,
  payload: () => jsonObjectSchema,
})

export const issueWorkProductInsertSchema = createInsertSchema(issueWorkProduct, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  runId: () => uuidSchema,
  agentId: () => uuidSchema,
  type: () => issueWorkProductTypeSchema,
  status: () => issueWorkProductStatusSchema,
  reviewState: () => issueWorkProductReviewStateSchema,
  payload: () => jsonObjectSchema,
})

export const issueSourceBindingSelectSchema = createSelectSchema(
  issueSourceBinding,
  {
    id: () => uuidSchema,
    workspaceId: () => uuidSchema,
    issueId: () => uuidSchema,
    connectorId: () => connectorIdSchema,
    sourceKind: () => sourceKindSchema,
    metadata: () => jsonObjectSchema,
  },
)

export const issueSourceBindingInsertSchema = createInsertSchema(
  issueSourceBinding,
  {
    id: () => uuidSchema,
    workspaceId: () => uuidSchema,
    issueId: () => uuidSchema,
    connectorId: () => connectorIdSchema,
    sourceKind: () => sourceKindSchema,
    metadata: () => jsonObjectSchema,
  },
)

export const issueRecurrenceSelectSchema = createSelectSchema(issueRecurrence, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
})

export const inboxDismissalSelectSchema = createSelectSchema(inboxDismissal, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  userId: () => uuidSchema,
})
