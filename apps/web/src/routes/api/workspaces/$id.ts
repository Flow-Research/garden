import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  notFound,
  requireSession,
  toWorkspace,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/workspaces/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const db = getDb(appEnv)
        const [workspace] = await db
          .select()
          .from(schema.workspace)
          .where(eq(schema.workspace.id, params.id))
        if (!workspace) return notFound('Workspace not found')
        return Response.json(toWorkspace(workspace))
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
        const db = getDb(appEnv)
        const [workspace] = await db
          .select()
          .from(schema.workspace)
          .where(eq(schema.workspace.id, params.id))
        if (!workspace) return notFound('Workspace not found')
        return Response.json(toWorkspace(workspace))
      },
    },
  },
})
