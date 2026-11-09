import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { matchError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import {
  badRequest,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { captureApiFailure } from '@/lib/server/api-logging'
import {
  connectorCallbackSearchParams,
  recordConnectorCallbackEvent,
} from '@/lib/server/connector-callback-events'
import {
  buildGitHubAppInstallUrl,
  createGitHubSetupState,
  normalizeGitHubAppEnv,
  resolveGitHubAppSlug,
} from '@/lib/server/github-app'
import { getGitHubAppInstallation } from '@garden/connectors/github-app'

function readConnectorFlowId(request: Request) {
  const value = new URL(request.url).searchParams.get('connector_flow')?.trim()
  return value || null
}

function redirectToGitHubPanel(request: Request, flowId?: string | null) {
  const url = new URL('/connectors', request.url)
  url.search = connectorCallbackSearchParams({
    connectorId: 'github',
    flowId,
  }).toString()
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

type GitHubInstallDb = Db

async function getConnectedGitHubInstall(args: {
  db: GitHubInstallDb
  workspaceId: string
}) {
  const [installation] = await args.db
    .select({
      id: schema.githubAppInstallation.id,
      installationId: schema.githubAppInstallation.installationId,
    })
    .from(schema.githubAppInstallation)
    .where(
      and(
        eq(schema.githubAppInstallation.workspaceId, args.workspaceId),
        eq(schema.githubAppInstallation.status, 'connected'),
      ),
    )
    .limit(1)

  return installation ?? null
}

export const Route = createFileRoute('/api/github/install')({
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

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId,
          permissions: workspacePermissions.connectionManage,
        })
        if (permission) return permission

        const flowId = readConnectorFlowId(request)
        const db = await appContext.db()

        const connectedInstallation = await getConnectedGitHubInstall({
          db,
          workspaceId,
        })
        const verifiedInstallation = connectedInstallation
          ? await getGitHubAppInstallation({
              env: normalizeGitHubAppEnv(appEnv),
              installationId: connectedInstallation.installationId,
            })
          : null

        if (connectedInstallation && verifiedInstallation?.isOk()) {
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

        if (
          connectedInstallation &&
          verifiedInstallation?.isErr() &&
          verifiedInstallation.error.status !== 404
        ) {
          await captureApiFailure({
            request,
            event: 'github.installation.verify_failed',
            error: verifiedInstallation.error,
            level: 'warn',
          })
          return Response.json(
            { error: 'Unable to verify the GitHub installation. Try again.' },
            { status: 502 },
          )
        }

        if (
          connectedInstallation &&
          verifiedInstallation?.isErr() &&
          verifiedInstallation.error.status === 404
        ) {
          await db
            .update(schema.githubAppInstallation)
            .set({ status: 'degraded', updatedAt: new Date() })
            .where(
              eq(schema.githubAppInstallation.id, connectedInstallation.id),
            )
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
