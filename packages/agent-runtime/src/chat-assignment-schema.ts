import { z } from 'zod'

const issueSelectorSchema = z
  .string()
  .min(1)
  .describe('Issue identifier like ISS-43, or an issue UUID.')

/**
 * Uses an explicit union so the exactly-one assignee contract survives AI SDK
 * JSON Schema generation. Zod refinements validate at runtime but disappear
 * from the model-visible schema, causing providers to omit or combine fields.
 */
export const assignIssueInputSchema = z.union([
  z
    .object({
      issue_id_or_identifier: issueSelectorSchema,
      assignee_agent_id: z
        .string()
        .uuid()
        .describe(
          'Active workspace agent id to assign. Todo remains queued until moved to In Progress.',
        ),
    })
    .strict(),
  z
    .object({
      issue_id_or_identifier: issueSelectorSchema,
      assignee_member: z
        .string()
        .trim()
        .min(1)
        .describe(
          'Workspace member name, email, user id, or membership id. Human assignments do not start an agent run.',
        ),
    })
    .strict(),
])
