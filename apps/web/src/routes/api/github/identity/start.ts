import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'
import { createGitHubSetupState } from '@/lib/server/github-app'
import {
  buildGitHubUserAuthorizeUrl,
  githubIdentityRedirectUri,
} from '@/lib/server/github-identity'

/**
 * Starts "Link with GitHub": signs an identity-purpose state bound to the
 * caller and their active workspace, then sends them to GitHub's user
 * authorization page for the Garden App. GitHub returns to the App's already
 * registered `/api/github/callback`, which forwards to `identity/complete`.
 */
export const Route = createFileRoute('/api/github/identity/start')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return badRequest('Workspace not found')

        const clientId = appEnv.GITHUB_CLIENT_ID?.trim()
        if (!clientId || !appEnv.GITHUB_CLIENT_SECRET?.trim()) {
          return Response.json(
            { error: 'GitHub sign-in is not configured' },
            { status: 503 },
          )
        }

        const state = await createGitHubSetupState({
          secret: appEnv.BETTER_AUTH_SECRET,
          userId: session.user.id,
          workspaceId,
          purpose: 'identity',
        })

        return new Response(null, {
          status: 302,
          headers: {
            location: buildGitHubUserAuthorizeUrl({
              clientId,
              redirectUri: githubIdentityRedirectUri(request),
              state,
            }),
          },
        })
      },
    },
  },
})
