import { createFileRoute } from '@tanstack/react-router'
import { matchError } from 'better-result'
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
  connectorCallbackSearchParams,
  recordConnectorCallbackEvent,
} from '@/lib/server/connector-callback-events'
import {
  buildGitHubAppInstallUrl,
  createGitHubSetupState,
  resolveGitHubAppSlug,
} from '@/lib/server/github-app'

function readConnectorFlowId(request: Request) {
  const value = new URL(request.url).searchParams.get('connector_flow')?.trim()
  return value || null
}

function redirectToGitHubPanel(request: Request, flowId?: string | null) {
  const url = new URL('/workspace', request.url)
  url.search = connectorCallbackSearchParams({
    connectorId: 'github',
    flowId,
  }).toString()
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

type GitHubInstallDb = ReturnType<typeof getDb>

async function hasConnectedGitHubInstall(args: {
  db: GitHubInstallDb
  workspaceId: string
}) {
  const [installation] = await args.db
    .select({ id: schema.githubAppInstallation.id })
    .from(schema.githubAppInstallation)
    .where(
      and(
        eq(schema.githubAppInstallation.workspaceId, args.workspaceId),
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
        const flowId = readConnectorFlowId(request)
        const db = getDb(appEnv)

        if (await hasConnectedGitHubInstall({ db, workspaceId })) {
          const event = await recordConnectorCallbackEvent({
            db,
            userId: session.user.id,
            workspaceId,
            connectorId: 'github',
            flowId,
            source: 'github_app',
            status: 'success',
            stage: 'already_connected',
            message: 'GitHub is already connected.',
          })

          return event.match({
            ok: () => redirectToGitHubPanel(request, flowId),
            err: (error) =>
              matchError(error, {
                ConnectorCallbackDatabaseError: (databaseError) =>
                  Response.json(
                    { error: databaseError.message },
                    { status: 500 },
                  ),
              }),
          })
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
                flowId,
              }),
            }),
          },
        })
      },
    },
  },
})
