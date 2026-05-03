import { z } from 'zod'
import { nonEmptyStringSchema, parseJsonBody } from './common'

export { parseJsonBody }

export const updateMeBodySchema = z
  .object({
    name: nonEmptyStringSchema.optional(),
    avatar_url: z.string().trim().min(1).optional().nullable(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'No valid changes submitted',
  )
