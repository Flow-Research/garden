import { jsonObjectSchema, uuidSchema } from '@garden/db/validation'
import { z } from 'zod'
import {
  nonEmptyStringSchema,
  optionalNonEmptyString,
  parseJsonBody,
} from './common'

export { parseJsonBody }

const agentVisibilitySchema = z.enum(['workspace', 'private'])
const agentStatusSchema = z.enum([
  'idle',
  'working',
  'blocked',
  'error',
  'offline',
])

export const createAgentBodySchema = z
  .object({
    name: nonEmptyStringSchema,
    description: optionalNonEmptyString,
    reports_to: uuidSchema.optional().nullable(),
    instructions: optionalNonEmptyString,
    avatar_url: optionalNonEmptyString,
    runtime_id: optionalNonEmptyString,
    runtime_config: jsonObjectSchema.optional().nullable(),
    custom_env: z.record(z.string(), z.string()).optional(),
    custom_args: z.array(z.string()).optional(),
    visibility: agentVisibilitySchema.optional(),
    max_concurrent_tasks: z.number().int().positive().optional(),
  })
  .strict()

export const updateAgentBodySchema = z
  .object({
    name: nonEmptyStringSchema.optional(),
    description: optionalNonEmptyString,
    reports_to: uuidSchema.optional().nullable(),
    instructions: optionalNonEmptyString,
    avatar_url: optionalNonEmptyString,
    runtime_id: optionalNonEmptyString,
    runtime_config: jsonObjectSchema.optional().nullable(),
    custom_env: z.record(z.string(), z.string()).optional(),
    custom_args: z.array(z.string()).optional(),
    visibility: agentVisibilitySchema.optional(),
    status: agentStatusSchema.optional(),
    max_concurrent_tasks: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'No valid agent changes submitted',
  )

export const setAgentSkillsBodySchema = z
  .object({
    skills: z.array(
      z
        .object({
          skill_id: uuidSchema,
          enabled: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
