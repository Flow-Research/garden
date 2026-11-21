import { Result } from 'better-result'
import { createRuntimeDbClient } from '@garden/db/runtime'
import {
  browserChatRefused,
  browserChatUnavailable,
  checkBrowserChatPrincipal,
  resolveBrowserChatPrincipal,
  type BrowserChatAuthorityError,
  type BrowserChatPrincipal,
} from '@garden/agent-runtime'
import { createBetterAuth } from '@/lib/auth/instance'
import type { AppEnv } from './env'
import { getChatFacetTarget } from './agent-do-path'

type AuthorityEnv = Pick<
  AppEnv,
  'HYPERDRIVE' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'
>

/** Uses the existing Better Auth verifier and explicitly closes its database client. */
export async function admitBrowserChatRequest(
  request: Request,
  env: AuthorityEnv,
): Promise<Result<BrowserChatPrincipal, BrowserChatAuthorityError>> {
  const target = getChatFacetTarget(request.url)
  if (target.kind !== 'chat') return Result.err(browserChatRefused())
  const url = new URL(request.url)
  const runtimeName = Result.try({
    try: () =>
      decodeURIComponent(url.pathname.split('/').filter(Boolean)[2] ?? ''),
    catch: () => browserChatRefused(),
  })
  if (runtimeName.isErr()) return runtimeName
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    const origin = request.headers.get('origin')
    const expected = new URL(env.BETTER_AUTH_URL ?? request.url).origin
    if (origin !== expected && origin !== 'garden-mobile://')
      return Result.err(browserChatRefused())
  }
  const result = await Result.tryPromise({
    try: async () => {
      const client = await createRuntimeDbClient(env.HYPERDRIVE)
      try {
        const auth = createBetterAuth(client.db, {
          BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL: env.BETTER_AUTH_URL,
          RESEND_API_KEY: undefined,
          authMode: 'session',
          request,
        })
        const session = await auth.api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true },
        })
        if (!session) return Result.err(browserChatRefused(401))
        return await resolveBrowserChatPrincipal(client.db, {
          sessionId: session.session.id,
          userId: session.user.id,
          runtimeName: runtimeName.value,
          threadName: target.threadName,
        })
      } finally {
        await client.close()
      }
    },
    catch: () => browserChatUnavailable(),
  })
  return Result.flatten(result)
}

/** Rechecks immutable server-owned IDs rather than cached cookie or browser state. */
export async function admitBrowserChatFrame(
  principal: BrowserChatPrincipal,
  env: Pick<AuthorityEnv, 'HYPERDRIVE'>,
): Promise<Result<BrowserChatPrincipal, BrowserChatAuthorityError>> {
  const result = await Result.tryPromise({
    try: async () => {
      const client = await createRuntimeDbClient(env.HYPERDRIVE)
      try {
        return await checkBrowserChatPrincipal(client.db, principal)
      } finally {
        await client.close()
      }
    },
    catch: () => browserChatUnavailable(),
  })
  return Result.flatten(result)
}
