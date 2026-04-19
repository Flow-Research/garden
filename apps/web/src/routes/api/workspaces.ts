import { createFileRoute } from '@tanstack/react-router'
import { appEnv } from '@/lib/server/env'
import { createAuth } from '@/lib/auth'
import {
  badRequest,
  requireSession,
  toWorkspace,
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
            toWorkspace(
              {
                ...organization,
                description: null,
                context: null,
                settings: {},
                plan: null,
                updatedAt: organization.createdAt,
                logo: organization.logo ?? null,
                metadata: organization.metadata ?? null,
              },
              'owner',
            ),
          ),
        )
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        if (typeof body?.name !== 'string' || typeof body?.slug !== 'string') {
          return badRequest('Invalid workspace payload')
        }
        const auth = createAuth(appEnv)
        const organization = await auth.api.createOrganization({
          headers: request.headers,
          body: {
            name: body.name,
            slug: body.slug,
            description:
              typeof body.description === 'string'
                ? body.description
                : undefined,
            context:
              typeof body.context === 'string' ? body.context : undefined,
          },
        })
        return Response.json(
          toWorkspace(
            {
              ...organization,
              description:
                typeof body.description === 'string' ? body.description : null,
              context: typeof body.context === 'string' ? body.context : null,
              settings: {},
              plan: null,
              updatedAt: organization.createdAt,
              logo: organization.logo ?? null,
              metadata: organization.metadata ?? null,
            },
            'owner',
          ),
          { status: 201 },
        )
      },
    },
  },
})
