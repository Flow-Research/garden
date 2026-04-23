import { env } from 'cloudflare:workers'

export type AppEnv = Pick<
  Env,
  'DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'OPENCODE_GO_API_KEY'
> & {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  MCP_PROXY_URL?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
}

export const appEnv = env as AppEnv
