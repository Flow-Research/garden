import { createFileRoute } from '@tanstack/react-router'
import { Result } from 'better-result'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireSession, unauthorized } from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'
import { captureApiFailure } from '@/lib/server/api-logging'
import { resolveGitHubSetupState } from '@/lib/server/github-app'
import {
  GitHubIdentityError,
  fetchVerifiedGitHubUser,
  githubIdentityRedirectUri,
  identityOutcomeForError,
  redirectWithIdentityOutcome,
  setOwnGitHubIdentity,
} from '@/lib/server/github-identity'

/**
 * Finishes "Link with GitHub". Verifies the identity-purpose state, requires
 * the signed-in user to be the one who started the flow (so a forwarded link
 * cannot attach someone else's GitHub account), exchanges the code for the
 * verified GitHub user, and saves it on the caller's own member row. Always
 * lands the member back on Home with `github_identity=linked|taken|failed`.
 */
export const Route = createFileRoute('/api/github/identity/complete')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const url = new URL(request.url)
        const code = url.searchParams.get('code') ?? ''
        const stateParam = url.searchParams.get('state') ?? ''

        const result = await Result.gen(async function* () {
          const state = yield* Result.await(
            resolveGitHubSetupState({
              secret: appEnv.BETTER_AUTH_SECRET,
              state: stateParam,
              purpose: 'identity',
            }),
          )
          if (state.userId !== session.user.id || !code) {
            return Result.err(
              new GitHubIdentityError({
                code: 'exchange_failed',
                message: 'This GitHub sign-in was started by another session',
              }),
            )
          }
          const identity = yield* Result.await(
            fetchVerifiedGitHubUser({
              clientId: appEnv.GITHUB_CLIENT_ID ?? '',
              clientSecret: appEnv.GITHUB_CLIENT_SECRET ?? '',
              code,
              redirectUri: githubIdentityRedirectUri(request),
            }),
          )
          yield* Result.await(
            setOwnGitHubIdentity({
              db: await appContext.db(),
              workspaceId: state.workspaceId,
              userId: session.user.id,
              identity,
            }),
          )
          return Result.ok(undefined)
        })

        return result.match({
          ok: async () => redirectWithIdentityOutcome(request, 'linked'),
          err: async (error) => {
            await captureApiFailure({
              request,
              event: 'github.identity.link_failed',
              error,
              level: 'warn',
            })
            return redirectWithIdentityOutcome(
              request,
              identityOutcomeForError(error),
            )
          },
        })
      },
    },
  },
})
