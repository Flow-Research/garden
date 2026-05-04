import { env } from 'cloudflare:workers'

type RequiredEnvBinding<Key extends keyof Env> = NonNullable<Env[Key]>

export type AppEnv = {
  DATABASE_URL: RequiredEnvBinding<'DATABASE_URL'>
  BETTER_AUTH_SECRET: RequiredEnvBinding<'BETTER_AUTH_SECRET'>
  BETTER_AUTH_URL: RequiredEnvBinding<'BETTER_AUTH_URL'>
  OPENCODE_GO_API_KEY: RequiredEnvBinding<'OPENCODE_GO_API_KEY'>
  FILES: RequiredEnvBinding<'FILES'>
  LOADER: RequiredEnvBinding<'LOADER'>
  SANDBOX_TRANSPORT: RequiredEnvBinding<'SANDBOX_TRANSPORT'>
  AGENT_DO: RequiredEnvBinding<'AGENT_DO'>
  Sandbox: RequiredEnvBinding<'Sandbox'>
  ENVIRONMENT?: 'development' | 'test' | 'production'
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_APP_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  MCP_PROXY_URL?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
}

export const appEnv = env as AppEnv
