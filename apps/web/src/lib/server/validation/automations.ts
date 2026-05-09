import { z } from 'zod'
import {
  automationConcurrencyPolicyValues,
  automationRunSourceValues,
  automationStatusValues,
} from '@garden/db/schema/automation-values'
import { issuePriorityValues } from '@garden/db/schema/issue-values'
import {
  nonEmptyStringSchema,
  nullableOptionalString,
  nonNegativeQueryIntSchema,
  optionalNonEmptyString,
  parseJsonBody,
  parseSearchParams,
  positiveQueryIntSchema,
} from './common'

const uuidSchema = z.string().uuid()
const automationStatusSchema = z.enum(automationStatusValues)
const automationRunSourceSchema = z.enum(automationRunSourceValues)
const automationConcurrencyPolicySchema = z.enum(
  automationConcurrencyPolicyValues,
)
const issuePrioritySchema = z.enum(issuePriorityValues)

const scheduleTriggerInputSchema = z
  .object({
    kind: z.literal('schedule').default('schedule'),
    label: nullableOptionalString,
    enabled: z.boolean().optional(),
    cron_expression: nonEmptyStringSchema,
    timezone: nonEmptyStringSchema,
  })
  .strict()

export const automationsListSearchSchema = z
  .object({
    status: automationStatusSchema.optional(),
    limit: positiveQueryIntSchema.max(100).optional(),
    offset: nonNegativeQueryIntSchema.optional(),
  })
  .strict()

export const createAutomationBodySchema = z
  .object({
    title: nonEmptyStringSchema,
    description: nullableOptionalString,
    issue_title_template: nullableOptionalString,
    assignee_agent_id: uuidSchema,
    priority: issuePrioritySchema.optional(),
    project_id: uuidSchema.optional().nullable(),
    status: automationStatusSchema.optional(),
    concurrency_policy: automationConcurrencyPolicySchema.optional(),
    trigger: scheduleTriggerInputSchema.optional(),
  })
  .strict()

export const updateAutomationBodySchema = z
  .object({
    title: optionalNonEmptyString,
    description: nullableOptionalString,
    issue_title_template: nullableOptionalString,
    assignee_agent_id: uuidSchema.optional(),
    priority: issuePrioritySchema.optional(),
    project_id: uuidSchema.optional().nullable(),
    status: automationStatusSchema.optional(),
    concurrency_policy: automationConcurrencyPolicySchema.optional(),
  })
  .strict()

export const createAutomationTriggerBodySchema = scheduleTriggerInputSchema

export const updateAutomationTriggerBodySchema = z
  .object({
    label: nullableOptionalString,
    enabled: z.boolean().optional(),
    cron_expression: nonEmptyStringSchema.optional(),
    timezone: nonEmptyStringSchema.optional(),
  })
  .strict()

export const automationRunsListSearchSchema = z
  .object({
    source: automationRunSourceSchema.optional(),
    limit: positiveQueryIntSchema.max(100).optional(),
    offset: nonNegativeQueryIntSchema.optional(),
  })
  .strict()

export const triggerAutomationBodySchema = z
  .object({
    source: z.enum(['manual', 'api']).optional(),
    payload: z.unknown().optional(),
  })
  .strict()

export { parseJsonBody, parseSearchParams }
