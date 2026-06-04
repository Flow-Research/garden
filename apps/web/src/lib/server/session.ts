import { createAuth } from '@/lib/auth'
import type { AppEnv } from '@/lib/server/env'

export function toCoreUser(input: {
  id: string
  email: string
  name?: string | null
  image?: string | null
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
}) {
  return {
    id: input.id,
    email: input.email,
    name: input.name ?? '',
    avatar_url: input.image ?? null,
    created_at: input.createdAt
      ? new Date(input.createdAt).toISOString()
      : new Date().toISOString(),
    updated_at: input.updatedAt
      ? new Date(input.updatedAt).toISOString()
      : new Date().toISOString(),
  }
}

/**
 * Resolves the Better Auth session for route loaders and server functions.
 * Before this request was not passed into `createAuth`, so staging sign-in
 * could set a valid session cookie while guarded routes still redirected to
 * `/login`. Passing the same request keeps Better Auth's runtime-origin and
 * cookie context aligned with the auth API route. Reference: Better Auth
 * handler/getSession request context and the local `createAuth` wrapper.
 */
export async function getAuthSession(
  request: Request,
  env: Pick<AppEnv, 'DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>,
) {
  const auth = createAuth(env, request)
  const result = await auth.api.getSession({ headers: request.headers })
  if (!result?.session || !result?.user) return null
  return result
}
