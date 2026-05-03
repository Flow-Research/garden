import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import {
  parseJsonBody,
  updateWorkspaceBodySchema,
} from '@/lib/server/validation/workspaces'
import { refreshChatThreadPromptConfig } from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
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

        const bodyResult = await parseJsonBody(
          request,
          updateWorkspaceBodySchema,
          'Invalid workspace payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const auth = createAuth(appEnv)
        const data: Record<string, unknown> = {}
        if (typeof body.name === 'string') data.name = body.name
        if (typeof body.slug === 'string') data.slug = body.slug
        if (typeof body.description === 'string') {
          data.description = body.description
        }
        if (typeof body.context === 'string') data.context = body.context
        if (Object.prototype.hasOwnProperty.call(body, 'settings')) {
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

        const db = getDb(appEnv)
        const threads = await db
          .select({
            id: schema.chatThread.id,
            hostName: schema.agent.hostName,
          })
          .from(schema.chatThread)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .where(eq(schema.chatThread.workspaceId, params.id))

        await Promise.all(
          threads.flatMap((thread) =>
            thread.hostName
              ? [
                  refreshChatThreadPromptConfig({
                    threadId: thread.id,
                    hostName: thread.hostName,
                  }),
                ]
              : [],
          ),
        )

        return Response.json(toWorkspaceFromOrganization(organization, role))
      },
    },
  },
})
