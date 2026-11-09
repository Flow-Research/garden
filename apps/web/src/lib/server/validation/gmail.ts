import { z } from 'zod'

const emailSchema = z.string().trim().email().max(320)
const recipientListSchema = z.array(emailSchema).max(50)
const cursorSchema = z.string().trim().min(1).max(4096).optional()
const idSchema = z.string().trim().min(1).max(256)

export const gmailComposeBodySchema = z
  .object({
    draftId: idSchema.optional(),
    to: z.array(emailSchema).min(1).max(50),
    cc: recipientListSchema.default([]),
    bcc: recipientListSchema.default([]),
    subject: z.string().trim().max(500).default(''),
    body: z.string().max(1_000_000).default(''),
  })
  .strict()

export const gmailDraftsQuerySchema = z
  .object({
    cursor: cursorSchema,
  })
  .strict()

export const gmailSentQuerySchema = z
  .object({
    id: idSchema.optional(),
    cursor: cursorSchema,
  })
  .strict()
