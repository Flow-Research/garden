import { z } from 'zod'
import {
  hostInterventionAnswerSchema,
  hostInterventionSchema,
} from './generated/host-contract'

export const interventionListSchema = z.strictObject({
  kind: z.literal('interventions'),
  workspaceId: z.string().uuid(),
  launchId: z.string().uuid(),
  observedAt: z.number().int().nonnegative().safe(),
  interventions: z
    .array(
      z.strictObject({
        intervention: hostInterventionSchema,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.enum(['open', 'answered', 'expired', 'closed']),
        receivedAt: z.number().int().nonnegative().safe(),
        answer: hostInterventionAnswerSchema.nullable(),
      }),
    )
    .max(100),
})

export type InterventionList = z.infer<typeof interventionListSchema>

export const attentionSchema = z.object({
  workspaceId: z.string().uuid(),
  runs: z.array(z.object({ launchId: z.string().uuid() })),
})
