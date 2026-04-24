import { createFileRoute } from '@tanstack/react-router'
import { appEnv } from '@/lib/server/env'
import { createAuth } from '@/lib/auth'
import {
  createWorkspaceBodySchema,
  parseJsonBody,
} from '@/lib/server/api-validation'
import {
  badRequest,
  requireSession,
  toWorkspaceFromOrganization,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const auth = createAuth(appEnv)
        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        })
        return Response.json(
          organizations.map((organization) =>
            toWorkspaceFromOrganization(organization, 'owner'),
          ),
        )
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          createWorkspaceBodySchema,
          'Invalid workspace payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const auth = createAuth(appEnv)
        const organization = await auth.api.createOrganization({
          headers: request.headers,
          body: {
            name: body.name,
            slug: body.slug,
            description: body.description ?? undefined,
            context: body.context ?? undefined,
          },
        })
        return Response.json(toWorkspaceFromOrganization(organization, 'owner'), {
          status: 201,
        })
      },
    },
  },
})
