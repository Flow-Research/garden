import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  createWorkspaceBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/workspaces'
import {
  badRequest,
  requireSession,
  toWorkspace,
  toWorkspaceFromOrganization,
  unauthorized,
} from '@/lib/server/control-plane'
import { createWorkspaceFromOrganizationApi } from '@/lib/server/workspaces/create-service'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import {
  capturePostHogEvent,
  identifyPostHogWorkspaceGroup,
} from '@/lib/posthog-server'

/**
 * `/api/workspaces` list/create. Auth + Zod here; create finishes through
 * `create-service` + `queries/workspaces` (no Drizzle in this route).
 * See `docs/decisions/2026-11-09-api-layering.md`.
 */
export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const auth = await appContext.auth.getAuth()
        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        })
        return Response.json(
          organizations.map((organization) =>
            toWorkspaceFromOrganization(organization, 'owner'),
          ),
        )
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          createWorkspaceBodySchema,
          'Invalid workspace payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const workspaceResult = await createWorkspaceFromOrganizationApi({
          auth: await appContext.auth.getAuth(),
          headers: request.headers,
          bucket: appContext.env.FILES,
          db: await appContext.db(),
          name: body.name,
          slug: body.slug,
          description: body.description,
          context: body.context,
          userId: session.user.id,
        })
        if (workspaceResult.isErr()) {
          return Response.json(
            { error: workspaceResult.error.message },
            { status: workspaceResult.error.status },
          )
        }

        identifyPostHogWorkspaceGroup(appContext, {
          distinctId: session.user.id,
          id: workspaceResult.value.id,
          properties: {
            name: body.name,
            slug: body.slug,
            description: body.description ?? null,
          },
        })
        capturePostHogEvent(appContext, {
          distinctId: session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.workspaceCreated,
          workspaceId: workspaceResult.value.id,
          properties: {
            workspace_name: body.name,
            workspace_slug: body.slug,
          },
        })
        return Response.json(toWorkspace(workspaceResult.value, 'owner'), {
          status: 201,
        })
      },
    },
  },
})
