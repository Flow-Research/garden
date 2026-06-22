import { setGardenLogLevel, type GardenLogLevel } from '@garden/observability/logger'

type RequiredEnvBinding<Key extends keyof Env> = NonNullable<Env[Key]>

export type AppEnv = {
  DATABASE_URL: RequiredEnvBinding<'DATABASE_URL'>
  HYPERDRIVE: RequiredEnvBinding<'HYPERDRIVE'>
  BETTER_AUTH_SECRET: RequiredEnvBinding<'BETTER_AUTH_SECRET'>
  BETTER_AUTH_URL?: string
  AI: RequiredEnvBinding<'AI'>
  AI_GATEWAY_ID?: string
  FILES: RequiredEnvBinding<'FILES'>
  LOADER: RequiredEnvBinding<'LOADER'>
  BROWSER: RequiredEnvBinding<'BROWSER'>
  MCP_PROXY: RequiredEnvBinding<'MCP_PROXY'>
  SANDBOX_TRANSPORT: RequiredEnvBinding<'SANDBOX_TRANSPORT'>
  GARDEN_LOG_LEVEL?: GardenLogLevel
  AgentDO: RequiredEnvBinding<'AgentDO'>
  AUTOMATION_TRIGGER: RequiredEnvBinding<'AUTOMATION_TRIGGER'>
  MCP_SESSION: RequiredEnvBinding<'MCP_SESSION'>
  Sandbox: RequiredEnvBinding<'Sandbox'>
  RUN_WORKFLOW: RequiredEnvBinding<'RUN_WORKFLOW'>
  ENVIRONMENT?: 'development' | 'test' | 'production'
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_APP_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
  RESEND_API_KEY: RequiredEnvBinding<'RESEND_API_KEY'>
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
  VITE_PUBLIC_POSTHOG_HOST?: string
}

// The custom Worker entry receives the authoritative Cloudflare bindings as the
// `env` argument. Keep this module free of a static `cloudflare:workers` import:
// route modules are also loaded by Vitest/Node, where that virtual protocol is
// unavailable, and `server.ts` refreshes the live binding at request start.
export let appEnv = {} as AppEnv

/** Updates live Worker bindings and applies runtime log-level configuration. */
export function bindAppEnv(nextEnv: AppEnv) {
  appEnv = nextEnv
  setGardenLogLevel(nextEnv.GARDEN_LOG_LEVEL)
}
