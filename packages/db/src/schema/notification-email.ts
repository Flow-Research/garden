import { z } from 'zod'

/** Persist the first send's exact payload so Resend retries remain idempotent. */
export const notificationEmailSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pending') }),
  z.object({
    kind: z.literal('sending'),
    startedAt: z.iso.datetime(),
    payload: z.object({
      to: z.email(),
      subject: z.string(),
      html: z.string(),
      text: z.string(),
    }),
  }),
  z.object({ kind: z.literal('sent'), providerId: z.string() }),
  z.object({ kind: z.literal('skipped'), reason: z.string() }),
  z.object({ kind: z.literal('failed'), reason: z.string() }),
])

export type NotificationEmail = z.infer<typeof notificationEmailSchema>
