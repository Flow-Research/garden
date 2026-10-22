import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  requireSession,
  requireWorkspaceAccess,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { teamIssueVisibilityCondition } from '@/lib/server/issue-access'
import { isWorkspaceManager } from '@/lib/server/team-access'

export const Route = createFileRoute('/api/issues/child-progress')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return Response.json({ progress: [] })

        const workspaceAccess = await requireWorkspaceAccess(
          appContext,
          workspaceId,
        )
        if (workspaceAccess instanceof Response) return workspaceAccess

        // Count children per parent in the database rather than loading every
        // issue in the workspace to tally them in memory.
        const db = await appContext.db()
        const rows = await db
          .select({
            parentId: schema.issue.parentId,
            total: sql<number>`cast(count(*) as int)`,
            done: sql<number>`cast(count(*) filter (where ${schema.issue.status} = 'done') as int)`,
          })
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.workspaceId, workspaceId),
              isNotNull(schema.issue.parentId),
              teamIssueVisibilityCondition({
                viewerId: session.user.id,
                manager: isWorkspaceManager(workspaceAccess.membership.role),
              }),
            ),
          )
          .groupBy(schema.issue.parentId)

        const progress = rows.flatMap((row) =>
          row.parentId
            ? [
                {
                  parent_issue_id: row.parentId,
                  total: row.total,
                  done: row.done,
                },
              ]
            : [],
        )

        return Response.json({ progress })
      },
    },
  },
})
