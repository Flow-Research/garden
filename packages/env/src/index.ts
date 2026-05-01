import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const serverSchema = {
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres connection string',
    ),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MCP_PROXY_URL: z.string().url().optional(),
  OPENCODE_GO_API_KEY: z.string().min(1).optional(),
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  ENVIRONMENT: z
    .enum(['development', 'test', 'production'])
    .default('development'),
} as const

type RuntimeEnv = Record<string, string | undefined>

function createServerEnv(runtimeEnv: RuntimeEnv) {
  return createEnv({
    server: serverSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
  })
}

export function parseServerEnv(runtimeEnv: RuntimeEnv) {
  return createServerEnv(runtimeEnv)
}

const nodeRuntimeEnv = ((globalThis as { process?: { env?: RuntimeEnv } })
  .process?.env ?? {}) as RuntimeEnv

export const serverEnv = createServerEnv(nodeRuntimeEnv)
