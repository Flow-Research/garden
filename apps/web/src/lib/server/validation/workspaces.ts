import { jsonObjectSchema, memberRoleSchema } from '@garden/db/validation'
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
    /**
     * Idempotent re-send of an existing pending invitation. The route refreshes
     * expiresAt on the existing row (covering expired invites, which Better
     * Auth's own resend flag excludes) instead of creating a duplicate.
     */
    resend: z.boolean().optional(),
  })
  .strict()

/**
 * GitHub login shape (max 39, alphanumeric/hyphen, no leading/trailing hyphen).
 * Paired with github_user_id for stable identity; login alone is not the key.
 */
export const githubLoginSchema = z
  .string()
  .trim()
  .regex(
    /^(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9])$/,
    'Invalid GitHub username',
  )

/** GitHub's numeric user id as a decimal string. */
export const githubUserIdSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Invalid GitHub user id')

/**
 * Role and/or GitHub identity update. github_* must both be omitted, both null
 * (unlink / not_linked), or both set (link). Role stays optional so self-link
 * does not require admin role permission.
 */
export const updateWorkspaceMemberBodySchema = z
  .object({
    role: memberRoleSchema.optional(),
    github_user_id: githubUserIdSchema.nullable().optional(),
    github_login: githubLoginSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.role !== undefined ||
      value.github_user_id !== undefined ||
      value.github_login !== undefined,
    'No valid member changes submitted',
  )
  .refine((value) => {
    const hasId = value.github_user_id !== undefined
    const hasLogin = value.github_login !== undefined
    if (!hasId && !hasLogin) return true
    if (hasId !== hasLogin) return false
    const idNull = value.github_user_id === null
    const loginNull = value.github_login === null
    return idNull === loginNull
  }, 'github_user_id and github_login must both be set or both be null')
