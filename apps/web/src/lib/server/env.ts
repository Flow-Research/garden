import { env } from 'cloudflare:workers'

type RequiredEnvBinding<Key extends keyof Env> = NonNullable<Env[Key]>

export type AppEnv = {
  DATABASE_URL: RequiredEnvBinding<'DATABASE_URL'>
  BETTER_AUTH_SECRET: RequiredEnvBinding<'BETTER_AUTH_SECRET'>
  BETTER_AUTH_URL: RequiredEnvBinding<'BETTER_AUTH_URL'>
  OPENCODE_GO_API_KEY: RequiredEnvBinding<'OPENCODE_GO_API_KEY'>
  FILES: RequiredEnvBinding<'FILES'>
  LOADER: RequiredEnvBinding<'LOADER'>
  MCP_PROXY: RequiredEnvBinding<'MCP_PROXY'>
  SANDBOX_TRANSPORT: RequiredEnvBinding<'SANDBOX_TRANSPORT'>
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
}

// The custom Worker entry receives the authoritative Cloudflare bindings as the
// `env` argument. `cloudflare:workers` can be incomplete while TanStack Start
// route modules are loaded through the wrapped handler, so server.ts refreshes
// this live binding at the start of each Worker request.
export let appEnv = env as AppEnv

export function bindAppEnv(nextEnv: AppEnv) {
  appEnv = nextEnv
}
