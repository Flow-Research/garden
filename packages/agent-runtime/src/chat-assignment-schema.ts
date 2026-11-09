import { z } from 'zod'

const issueSelectorSchema = z
  .string()
  .min(1)
  .describe('Issue identifier like ISS-43, or an issue UUID.')

export const assignIssueInputSchema = z
  .object({
    issue_id_or_identifier: issueSelectorSchema,
    target: z
      .enum(['agent', 'member'])
      .describe('Whether to assign an active agent or a human member.'),
    assignee_agent_id: z
      .string()
      .uuid()
      .optional()
      .describe('Active workspace agent id. Required when target is "agent".'),
    assignee_member: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Workspace member name, email, user id, or membership id. Required when target is "member".',
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.target === 'agent') {
      if (value.assignee_agent_id === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'target "agent" requires assignee_agent_id.',
        })
      }
      if (value.assignee_member !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'target "agent" must not include assignee_member.',
        })
      }
    }
    if (value.target === 'member') {
      if (value.assignee_member === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'target "member" requires assignee_member.',
        })
      }
      if (value.assignee_agent_id !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'target "member" must not include assignee_agent_id.',
        })
      }
    }
  })
