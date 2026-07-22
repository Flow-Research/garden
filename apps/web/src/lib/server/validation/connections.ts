import { uuidSchema } from '@garden/db/validation'
import { z } from 'zod'
import { parseJsonBody } from './common'

export { parseJsonBody }

const permissionTrustLevelSchema = z.enum(['auto', 'allow', 'ask'])
const connectionOwnerSchema = z.enum(['user', 'org'])
const connectionActionSchema = z.enum([
  'connect',
  'disconnect',
  'delete',
  'resync',
])

export const connectionActionBodySchema = z
  .object({
    action: connectionActionSchema,
  })
  .strict()

export const connectionCredentialBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    owner: connectionOwnerSchema,
    template: z.string().trim().min(1).max(128),
    values: z.record(z.string().trim().min(1).max(128), z.string().min(1)),
  })
  .strict()

export const connectionGrantBodySchema = z
  .object({
    agentId: uuidSchema,
    trustLevel: permissionTrustLevelSchema,
  })
  .strict()
