import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import { parseJsonBody, updateMeBodySchema } from '@/lib/server/validation/me'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { toCoreUser } from '@/lib/server/session'

export const Route = createFileRoute('/api/me')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const db = await appContext.db()
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
      PATCH: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
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

        const db = await appContext.db()
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
