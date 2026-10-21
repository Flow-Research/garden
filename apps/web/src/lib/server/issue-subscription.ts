import { eq } from 'drizzle-orm'
import { setIssueSubscription } from '@garden/db/subscribers'
import type { AppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { issueSubscriptionBodySchema } from '@/lib/server/validation/issues'
import { isWorkspaceParticipant } from '@/lib/server/workspace-refs'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

/**
 * Shared body of the subscribe and unsubscribe routes. The body may name
 * another participant (`user_id` + `user_type`, e.g. tagging an agent in from
 * the participants panel); absent, it targets the current member. Changing
 * anyone else's subscription needs issue-manage permission, and the target must
 * belong to the issue's workspace.
 */
export async function updateIssueSubscription(input: {
  appContext: AppRequestContext
  issueId: string
  subscribed: boolean
}) {
  const { appContext, issueId, subscribed } = input
  const db = await appContext.db()
  const [issue] = await db
    .select({ workspaceId: schema.issue.workspaceId })
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
  if (!issue) return notFound('Issue not found')

  const access = await requireWorkspaceAccess(appContext, issue.workspaceId)
  if (access instanceof Response) return access

  const rawBody: unknown = await appContext.request.json().catch(() => ({}))
  const body = issueSubscriptionBodySchema.safeParse(rawBody)
  if (!body.success) return badRequest('Invalid subscription payload')

  const participant = {
    type: body.data.user_type ?? 'member',
    id: body.data.user_id ?? access.session.user.id,
  } as const
  const isSelf =
    participant.type === 'member' && participant.id === access.session.user.id

  if (!isSelf) {
    const permission = await requireWorkspacePermission({
      appContext,
      request: appContext.request,
      workspaceId: issue.workspaceId,
      permissions: workspacePermissions.issueManage,
    })
    if (permission) return permission

    if (!(await isWorkspaceParticipant(db, issue.workspaceId, participant))) {
      return badRequest('Participant is not in this workspace')
    }
  }

  await setIssueSubscription(db, {
    workspaceId: issue.workspaceId,
    issueId,
    userType: participant.type,
    userId: participant.id,
    subscribed,
  })

  return new Response(null, { status: 204 })
}
