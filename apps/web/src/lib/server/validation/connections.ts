import { uuidSchema } from '@garden/db/validation'
import { z } from 'zod'
import { parseJsonBody } from './common'

export { parseJsonBody }

const permissionTrustLevelSchema = z.enum(['auto', 'allow', 'ask'])
const connectionActionSchema = z.enum(['disconnect', 'resync'])

export const connectionActionBodySchema = z
  .object({
    action: connectionActionSchema,
  })
  .strict()

export const connectionGrantBodySchema = z
  .object({
    agentId: uuidSchema,
    trustLevel: permissionTrustLevelSchema,
  })
  .strict()
