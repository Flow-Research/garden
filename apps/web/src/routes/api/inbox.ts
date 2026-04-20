import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { buildInboxItemsFromIssues } from '@/lib/server/workspace-surfaces'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json([])

        const db = getDb(appEnv)
        const issues = await db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.workspaceId, workspaceId))

        return Response.json(
          buildInboxItemsFromIssues({
            issues,
            userId: session.user.id,
            workspaceId,
          }),
        )
      },
    },
  },
})
