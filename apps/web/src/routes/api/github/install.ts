import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import {
  badRequest,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  buildGitHubAppInstallUrl,
  createGitHubSetupState,
  resolveGitHubAppSlug,
} from '@/lib/server/github-app'

function redirectToGitHubPanel(request: Request, status: string) {
  const url = new URL('/workspace', request.url)
  url.searchParams.set('panel', 'capabilities')
  url.searchParams.set('panelTitle', 'GitHub')
  url.searchParams.set('panelEntityId', 'github')
  url.searchParams.set('github_setup', status)
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

async function hasConnectedGitHubInstall(workspaceId: string) {
  const db = getDb(appEnv)
  const [installation] = await db
    .select({ id: schema.githubAppInstallation.id })
    .from(schema.githubAppInstallation)
    .where(
      and(
        eq(schema.githubAppInstallation.workspaceId, workspaceId),
        eq(schema.githubAppInstallation.status, 'connected'),
      ),
    )
    .limit(1)

  return Boolean(installation)
}

export const Route = createFileRoute('/api/github/install')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return badRequest('Workspace not found')

        if (await hasConnectedGitHubInstall(workspaceId)) {
          return redirectToGitHubPanel(request, 'connected')
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: buildGitHubAppInstallUrl({
              appSlug: resolveGitHubAppSlug(appEnv),
              state: await createGitHubSetupState({
                secret: appEnv.BETTER_AUTH_SECRET,
                userId: session.user.id,
                workspaceId,
              }),
            }),
          },
        })
      },
    },
  },
})
