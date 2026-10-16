import { z } from 'zod'

export const executorCatalogSchema = z.object({
  integrations: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string(),
    }),
  ),
  connections: z.array(
    z.object({
      owner: z.enum(['org', 'user']),
      integration: z.string(),
      name: z.string(),
      identityLabel: z.string().nullish(),
    }),
  ),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      integration: z.string(),
      connection: z.string(),
      owner: z.enum(['org', 'user']),
      requiresApproval: z.boolean(),
    }),
  ),
})

export type ExecutorCatalog = z.infer<typeof executorCatalogSchema>
