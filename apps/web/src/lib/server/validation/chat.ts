import { uuidSchema } from '@garden/db/validation'
import { z } from 'zod'
import {
  datetimeStringSchema,
  nonEmptyStringSchema,
  parseJsonBody,
  parseSearchParams,
} from './common'

export { parseJsonBody, parseSearchParams }

export const createChatThreadBodySchema = z
  .object({
    id: uuidSchema.optional(),
    title: z.string().trim().optional(),
    agent_id: uuidSchema.optional(),
    exclude_thread_ids: z.array(uuidSchema).optional(),
    primary_issue_id: uuidSchema.optional(),
  })
  .strict()

export const updateChatThreadBodySchema = z
  .object({
    title: nonEmptyStringSchema,
    lastMessage: z.string().optional(),
    archivedAt: datetimeStringSchema.optional().nullable(),
    updatedAt: datetimeStringSchema.optional(),
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'No valid chat thread changes submitted',
  )

export const toolApprovalBodySchema = z
  .object({
    toolCallId: z.string().trim().min(1).optional(),
    permission_request_id: uuidSchema.optional(),
    approved: z.boolean(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.toolCallId) !== Boolean(value.permission_request_id),
    'Exactly one approval identifier is required',
  )

export const threadDebugQuerySchema = z.object({
  thread_id: uuidSchema.optional(),
  session_id: uuidSchema.optional(),
})
