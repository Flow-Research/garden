import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/child-progress')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json({ progress: [] })

        const db = await appContext.db()
        const rows = await db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.workspaceId, workspaceId))

        const progress = Array.from(
          rows.reduce((map, issue) => {
            if (!issue.parentId) return map
            const entry = map.get(issue.parentId) ?? { total: 0, done: 0 }
            entry.total += 1
            if (issue.status === 'done') entry.done += 1
            map.set(issue.parentId, entry)
            return map
          }, new Map<string, { total: number; done: number }>()),
        ).map(([parent_issue_id, entry]) => ({
          parent_issue_id,
          total: entry.total,
          done: entry.done,
        }))

        return Response.json({ progress })
      },
    },
  },
})
