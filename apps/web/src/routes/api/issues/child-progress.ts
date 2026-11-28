import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  requireSession,
  requireWorkspaceAccess,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { isWorkspaceManager } from '@/lib/server/team-access'
import { listChildIssueProgress } from '@/lib/server/queries/issues'

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

        const db = await appContext.db()
        const rows = await listChildIssueProgress(db, {
          workspaceId,
          viewerId: session.user.id,
          manager: isWorkspaceManager(workspaceAccess.membership.role),
        })

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
