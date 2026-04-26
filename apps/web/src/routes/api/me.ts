import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import { parseJsonBody, updateMeBodySchema } from '@/lib/server/api-validation'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { toCoreUser } from '@/lib/server/session'

export const Route = createFileRoute('/api/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const db = getDb(appEnv)
        const [user] = await db
          .select()
          .from(schema.user)
          .where(eq(schema.user.id, session.user.id))

        if (!user) return unauthorized()

        return Response.json(
          toCoreUser({
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.avatarUrl ?? null,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          }),
        )
      },
      PATCH: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const bodyResult = await parseJsonBody(
          request,
          updateMeBodySchema,
          'Invalid profile payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const updateValues: Partial<typeof schema.user.$inferInsert> = {}

        if (typeof body.name === 'string') {
          updateValues.name = body.name
        }

        if (Object.prototype.hasOwnProperty.call(body, 'avatar_url')) {
          updateValues.avatarUrl = body.avatar_url ?? null
        }

        if (Object.keys(updateValues).length === 0) {
          return badRequest('No valid changes submitted')
        }

        updateValues.updatedAt = new Date()

        const db = getDb(appEnv)
        const [updated] = await db
          .update(schema.user)
          .set(updateValues)
          .where(eq(schema.user.id, session.user.id))
          .returning()

        if (!updated) return unauthorized()

        return Response.json({
          id: updated.id,
          name: updated.name,
          email: updated.email,
          avatar_url: updated.avatarUrl ?? null,
          created_at: updated.createdAt
            ? new Date(updated.createdAt).toISOString()
            : new Date().toISOString(),
          updated_at: updated.updatedAt
            ? new Date(updated.updatedAt).toISOString()
            : new Date().toISOString(),
        })
      },
    },
  },
})
