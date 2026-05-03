import { z } from 'zod'
import { parseSearchParams } from './common'

export { parseSearchParams }

const githubSetupActionSchema = z.enum([
  'install',
  'update',
  'request',
  'remove',
])

export const githubSetupQuerySchema = z.object({
  installation_id: z.string().trim().min(1),
  setup_action: githubSetupActionSchema.optional(),
  state: z.string().trim().optional(),
})
