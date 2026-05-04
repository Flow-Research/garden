import {
  issueSourceBindingInsertSchema,
  issuePrioritySchema,
  issueStatusSchema,
  uuidSchema,
} from '@garden/db/validation'
import { z } from 'zod'
import {
  datetimeStringSchema,
  nonEmptyStringSchema,
  nonNegativeQueryIntSchema,
  nullableOptionalString,
  parseJsonBody,
  parseSearchParams,
  positiveQueryIntSchema,
} from './common'

export { parseJsonBody, parseSearchParams }

const issueApiAssigneeTypeSchema = z.enum(['member', 'agent'])

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
    title: nonEmptyStringSchema,
    description: nullableOptionalString,
    status: issueStatusSchema.optional(),
    priority: issuePrioritySchema.optional(),
    assignee_type: issueApiAssigneeTypeSchema.optional().nullable(),
    assignee_id: uuidSchema.optional().nullable(),
    parent_issue_id: uuidSchema.optional().nullable(),
    project_id: uuidSchema.optional().nullable(),
    due_date: datetimeStringSchema.optional().nullable(),
    attachment_ids: z.array(uuidSchema).optional(),
  })
  .strict()

export const updateIssueBodySchema = z
  .object({
    title: nonEmptyStringSchema.optional(),
    description: nullableOptionalString,
    status: issueStatusSchema.optional(),
    priority: issuePrioritySchema.optional(),
    assignee_type: issueApiAssigneeTypeSchema.optional().nullable(),
    assignee_id: uuidSchema.optional().nullable(),
    parent_issue_id: uuidSchema.optional().nullable(),
    project_id: uuidSchema.optional().nullable(),
    position: z.number().finite().optional(),
    due_date: datetimeStringSchema.optional().nullable(),
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
