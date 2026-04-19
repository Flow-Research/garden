import { env } from 'cloudflare:workers'

export type AppEnv = Pick<
  Env,
  'DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'OPENCODE_GO_API_KEY'
>

export const appEnv: AppEnv = env
