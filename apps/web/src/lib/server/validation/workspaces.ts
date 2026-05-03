import {
  jsonObjectSchema,
  memberRoleSchema,
} from '@garden/db/validation'
import { z } from 'zod'
import {
  nonEmptyStringSchema,
  nullableOptionalString,
  parseJsonBody,
} from './common'

export { parseJsonBody }

export const createWorkspaceBodySchema = z
  .object({
    name: nonEmptyStringSchema,
    slug: nonEmptyStringSchema,
    description: nullableOptionalString,
    context: nullableOptionalString,
  })
  .strict()

export const updateWorkspaceBodySchema = z
  .object({
    name: nonEmptyStringSchema.optional(),
    slug: nonEmptyStringSchema.optional(),
    description: nullableOptionalString,
    context: nullableOptionalString,
    settings: jsonObjectSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'No valid workspace changes submitted',
  )

export const createWorkspaceMemberBodySchema = z
  .object({
    email: z.string().trim().email(),
    role: memberRoleSchema.optional(),
  })
  .strict()

export const updateWorkspaceMemberBodySchema = z
  .object({
    role: memberRoleSchema,
  })
  .strict()
