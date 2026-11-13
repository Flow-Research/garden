import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { setOwnGitHubIdentity } from '@/lib/server/github-identity'

/**
 * Lets a member clear the GitHub identity on their own row. Clearing proves
 * nothing about anyone else's account, so it needs no owner/admin role; the
 * admin PATCH on /members stays the path for editing other members.
 */
export const Route = createFileRoute('/api/github/identity/unlink')({
  server: {
    handlers: {
      POST: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return badRequest('Workspace not found')

        const result = await setOwnGitHubIdentity({
          db: await appContext.db(),
          workspaceId,
          userId: session.user.id,
          identity: null,
        })
        return result.match({
          ok: () => json({ ok: true }),
          err: (error) =>
            json(
              { error: error.message, code: error.code },
              error.code === 'member_not_found' ? 404 : 500,
            ),
        })
      },
    },
  },
})
