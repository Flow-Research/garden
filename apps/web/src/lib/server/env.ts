import { parseServerEnv } from '@garden/env'
import {
  createGardenLogger,
  errorFields,
  setGardenLogLevel,
} from '@garden/observability/logger'

const logger = createGardenLogger({
  service: 'garden-staging',
  component: 'env',
})

type RequiredEnvBinding<Key extends keyof Env> = NonNullable<Env[Key]>

export type AppEnv = {
  DATABASE_URL: RequiredEnvBinding<'DATABASE_URL'>
  HYPERDRIVE: RequiredEnvBinding<'HYPERDRIVE'>
  BETTER_AUTH_SECRET: RequiredEnvBinding<'BETTER_AUTH_SECRET'>
  BETTER_AUTH_URL?: string
  AI: RequiredEnvBinding<'AI'>
  AI_GATEWAY_ID?: string
  BRAIN_FILES: RequiredEnvBinding<'BRAIN_FILES'>
  FILES: RequiredEnvBinding<'FILES'>
  LOADER: RequiredEnvBinding<'LOADER'>
  BROWSER: RequiredEnvBinding<'BROWSER'>
  EXECUTOR_DB: RequiredEnvBinding<'EXECUTOR_DB'>
  EXECUTOR_BLOBS: RequiredEnvBinding<'EXECUTOR_BLOBS'>
  EXECUTOR_MCP_SESSION: RequiredEnvBinding<'EXECUTOR_MCP_SESSION'>
  EXECUTOR_MCP_EXECUTION_OWNER: RequiredEnvBinding<'EXECUTOR_MCP_EXECUTION_OWNER'>
  EXECUTOR_SECRET_KEY: string
  SANDBOX_TRANSPORT: RequiredEnvBinding<'SANDBOX_TRANSPORT'>
  GARDEN_LOG_LEVEL?: RequiredEnvBinding<'GARDEN_LOG_LEVEL'>
  AgentDO: RequiredEnvBinding<'AgentDO'>
  AUTOMATION_TRIGGER: RequiredEnvBinding<'AUTOMATION_TRIGGER'>
  WORKSPACE_REALTIME: RequiredEnvBinding<'WORKSPACE_REALTIME'>
  Sandbox: RequiredEnvBinding<'Sandbox'>
  RUN_WORKFLOW: RequiredEnvBinding<'RUN_WORKFLOW'>
  DECIDE_ANALYSIS_WORKFLOW: RequiredEnvBinding<'DECIDE_ANALYSIS_WORKFLOW'>
  ENVIRONMENT?: 'development' | 'test' | 'staging' | 'production'
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_APP_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  GOOGLE_AUTH_CLIENT_ID?: string
  GOOGLE_AUTH_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  DISCORD_BOT_TOKEN?: string
  DISCORD_PUBLIC_KEY?: string
  DISCORD_BOT_PERMISSIONS?: string
  RESEND_API_KEY?: string
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
  VITE_PUBLIC_POSTHOG_HOST?: string
  EXA_API_KEY?: string
  HELIX_URL?: string
  HELIX_API_KEY?: string
}

// The custom Worker entry receives the authoritative Cloudflare bindings as the
// `env` argument. Keep this module free of a static `cloudflare:workers` import:
// route modules are also loaded by Vitest/Node, where that virtual protocol is
// unavailable, and `server.ts` refreshes the live binding at request start.
export let appEnv = {} as AppEnv

const validatedEnvs = new WeakSet<AppEnv>()

/**
 * Checks the string bindings against the shared @garden/env schema once per
 * isolate and logs anything missing or malformed. It reports rather than
 * throws: a misconfigured optional integration should not take the whole
 * Worker down, but it must show up in logs instead of failing obscurely later.
 */
function reportInvalidEnv(env: AppEnv) {
  if (validatedEnvs.has(env)) return
  validatedEnvs.add(env)

  const stringBindings = Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  try {
    parseServerEnv(stringBindings)
  } catch (error) {
    logger.error('env.invalid_bindings', errorFields(error))
  }
}

/** Updates live Worker bindings and applies runtime log-level configuration. */
export function bindAppEnv(nextEnv: AppEnv) {
  appEnv = nextEnv
  setGardenLogLevel(nextEnv.GARDEN_LOG_LEVEL)
  reportInvalidEnv(nextEnv)
}
