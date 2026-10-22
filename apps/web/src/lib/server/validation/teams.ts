import { uuidSchema } from '@garden/db/validation'
import { z } from 'zod'

export const teamNameSchema = z.string().trim().min(1).max(100)
export const teamDescriptionSchema = z.string().max(5000)

/**
 * Membership writes are a discriminated union so a request can never carry
 * both user_id and agent_id (mirrors the database check constraint).
 */
export const addTeamMemberBodySchema = z.discriminatedUnion('member_type', [
  z.object({ member_type: z.literal('user'), user_id: uuidSchema }),
  z.object({ member_type: z.literal('agent'), agent_id: uuidSchema }),
])

export const createTeamBodySchema = z
  .object({
    name: teamNameSchema,
    description: teamDescriptionSchema.optional().nullable(),
    owner_user_id: uuidSchema.optional(),
    initial_members: z.array(addTeamMemberBodySchema).max(100).optional(),
  })
  .strict()

export const updateTeamBodySchema = z
  .object({
    name: teamNameSchema.optional(),
    description: teamDescriptionSchema.optional().nullable(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    'No valid team changes submitted',
  )

export const transferTeamOwnerBodySchema = z
  .object({
    owner_user_id: uuidSchema,
  })
  .strict()
