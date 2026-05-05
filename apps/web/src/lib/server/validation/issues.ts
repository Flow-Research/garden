import {
  issueInsertSchema,
  issueSourceBindingInsertSchema,
  issuePrioritySchema,
  issueStatusSchema,
  issueUpdateSchema,
  uuidSchema,
} from '@garden/db/validation'
import { z } from 'zod'
import {
  datetimeStringSchema,
  nonNegativeQueryIntSchema,
  parseJsonBody,
  parseSearchParams,
  positiveQueryIntSchema,
} from './common'

export { parseJsonBody, parseSearchParams }

const issueApiAssigneeTypeSchema = z.enum(['member', 'agent'])
const issueDueDateApiSchema = z.union([
  datetimeStringSchema,
  issueInsertSchema.shape.dueDate,
])

export const commentBodySchema = z
  .object({
    content: z.string().trim().min(1),
    type: z
      .enum(['comment', 'status_change', 'progress_update', 'system'])
      .optional(),
    parent_id: uuidSchema.optional().nullable(),
    attachment_ids: z.array(uuidSchema).optional(),
  })
  .strict()

export const reactionBodySchema = z
  .object({
    emoji: z.string().trim().min(1),
  })
  .strict()

export const issuesListSearchSchema = z.object({
  status: issueStatusSchema.optional(),
  priority: issuePrioritySchema.optional(),
  assignee_id: uuidSchema.optional(),
  assignee_ids: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(uuidSchema))
    .optional(),
  creator_id: uuidSchema.optional(),
  open_only: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: positiveQueryIntSchema.max(100).optional(),
  offset: nonNegativeQueryIntSchema.optional(),
})

export const createIssueBodySchema = z
  .object({
    title: issueInsertSchema.shape.title,
    description: issueInsertSchema.shape.description.optional().nullable(),
    status: issueInsertSchema.shape.status.optional(),
    priority: issueInsertSchema.shape.priority.optional(),
    assignee_type: issueApiAssigneeTypeSchema.optional().nullable(),
    assignee_id: issueInsertSchema.shape.assigneeId.optional().nullable(),
    parent_issue_id: issueInsertSchema.shape.parentId.optional().nullable(),
    project_id: issueInsertSchema.shape.projectId.optional().nullable(),
    due_date: issueDueDateApiSchema.optional().nullable(),
    attachment_ids: z.array(uuidSchema).optional(),
  })
  .strict()

export const updateIssueBodySchema = z
  .object({
    title: issueUpdateSchema.shape.title.optional(),
    description: issueUpdateSchema.shape.description.optional().nullable(),
    status: issueUpdateSchema.shape.status.optional(),
    priority: issueUpdateSchema.shape.priority.optional(),
    assignee_type: issueApiAssigneeTypeSchema.optional().nullable(),
    assignee_id: issueUpdateSchema.shape.assigneeId.optional().nullable(),
    parent_issue_id: issueUpdateSchema.shape.parentId.optional().nullable(),
    project_id: issueUpdateSchema.shape.projectId.optional().nullable(),
    position: issueUpdateSchema.shape.position.optional(),
    due_date: issueDueDateApiSchema.optional().nullable(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'No valid issue changes submitted',
  )

export const sourceBindingBodySchema = z
  .object({
    connector_id: issueSourceBindingInsertSchema.shape.connectorId,
    source_kind: issueSourceBindingInsertSchema.shape.sourceKind,
    external_id: issueSourceBindingInsertSchema.shape.externalId,
    external_url: z.string().trim().min(1).optional().nullable(),
  })
  .strict()

export const issueSearchQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  limit: positiveQueryIntSchema.max(100).optional(),
  offset: nonNegativeQueryIntSchema.optional(),
  include_closed: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})
