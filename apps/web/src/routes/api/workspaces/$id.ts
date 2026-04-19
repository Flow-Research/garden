import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'
import {
  notFound,
  requireSession,
  toWorkspaceFromOrganization,
  unauthorized,
} from '@/lib/server/control-plane'

type FullOrganization = {
  id: string
  name: string
  slug: string
  createdAt: Date | string
  logo?: string | null
  metadata?: unknown
  description?: string | null
  context?: string | null
  settings?: unknown
  plan?: string | null
  updatedAt?: Date | string | null
  members: Array<{
    userId: string
    role: string
  }>
} | null

export const Route = createFileRoute('/api/workspaces/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const auth = createAuth(appEnv)
        const organization = (await auth.api.getFullOrganization({
          headers: request.headers,
          query: {
            organizationId: params.id,
          },
        })) as FullOrganization

        if (!organization) return notFound('Workspace not found')

        const role =
          organization.members.find((member) => member.userId === session.user.id)
            ?.role ?? 'member'

        return Response.json(toWorkspaceFromOrganization(organization, role))
      },
      PATCH: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        const auth = createAuth(appEnv)
        const data: Record<string, unknown> = {}
        if (typeof body?.name === 'string') data.name = body.name
        if (typeof body?.slug === 'string') data.slug = body.slug
        if (typeof body?.description === 'string')
          data.description = body.description
        if (typeof body?.context === 'string') data.context = body.context
        if (
          body &&
          Object.prototype.hasOwnProperty.call(body, 'settings') &&
          body.settings &&
          typeof body.settings === 'object' &&
          !Array.isArray(body.settings)
        ) {
          data.settings = body.settings
        }
        await auth.api.updateOrganization({
          headers: request.headers,
          body: {
            organizationId: params.id,
            data,
          },
        })

        const organization = (await auth.api.getFullOrganization({
          headers: request.headers,
          query: {
            organizationId: params.id,
          },
        })) as FullOrganization

        if (!organization) return notFound('Workspace not found')

        const role =
          organization.members.find((member) => member.userId === session.user.id)
            ?.role ?? 'member'

        return Response.json(toWorkspaceFromOrganization(organization, role))
      },
    },
  },
})
