import { createFileRoute } from '@tanstack/react-router'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  githubSetupQuerySchema,
  parseSearchParams,
} from '@/lib/server/api-validation'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  completeGitHubAppInstallation,
  resolveGitHubSetupState,
} from '@/lib/server/github-app'
import { and, eq } from 'drizzle-orm'

function isDevelopmentEnv() {
  return appEnv.ENVIRONMENT === 'development'
}

function redirectToConnections(request: Request, status?: string) {
  const redirectOrigin = isDevelopmentEnv()
    ? appEnv.BETTER_AUTH_URL
    : new URL(request.url).origin
  const url = new URL('/workspace', redirectOrigin)
  url.searchParams.set('panel', 'capabilities')
  url.searchParams.set('panelTitle', 'GitHub')
  url.searchParams.set('panelEntityId', 'github')
  if (status) url.searchParams.set('github_setup', status)
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

export const Route = createFileRoute('/api/github/setup')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = parseSearchParams(
          request,
          githubSetupQuerySchema,
          'Invalid GitHub setup callback',
        )
        if (query.isErr()) return badRequest(query.error.message)

        if (!query.value.state) {
          return badRequest('GitHub setup callback is missing state')
        }

        const stateResult = await resolveGitHubSetupState({
          secret: appEnv.BETTER_AUTH_SECRET,
          state: query.value.state,
        })
        if (stateResult.isErr()) return badRequest(stateResult.error.message)

        const { userId, workspaceId } = stateResult.value
        if (!workspaceId) return badRequest('Workspace not found')

        if (!isDevelopmentEnv()) {
          const session = await requireSession(request)
          if (!session) return unauthorized()
          if (session.user.id !== userId) return unauthorized()
        }

        const db = getDb(appEnv)
        const [membership] = await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, workspaceId),
              eq(schema.member.userId, userId),
            ),
          )
          .limit(1)
        if (!membership) return unauthorized()

        const installResult = await completeGitHubAppInstallation({
          env: appEnv,
          userId,
          workspaceId,
          installationId: query.value.installation_id,
        })
        if (installResult.isErr()) {
          return Response.json(
            { error: installResult.error.message },
            { status: 500 },
          )
        }

        const syncResult = await syncCapabilities(
          'github',
          userId,
          workspaceId,
        )
        if (syncResult.isErr()) {
          return Response.json(
            { error: syncResult.error.message, code: syncResult.error.code },
            { status: 502 },
          )
        }

        return redirectToConnections(request, 'connected')
      },
    },
  },
})
