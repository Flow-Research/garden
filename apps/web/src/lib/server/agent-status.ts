import { and, eq } from 'drizzle-orm'
import type { AppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  notFound,
  requireWorkspaceAccess,
  toAgent,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

/** Archives or restores an agent; requires agent-manage permission. */
export async function setAgentStatus(input: {
  appContext: AppRequestContext
  agentId: string
  status: 'active' | 'archived'
}) {
  const { appContext, agentId, status } = input
  const db = await appContext.db()
  const [existingAgent] = await db
    .select({ workspaceId: schema.agent.workspaceId })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
  if (!existingAgent) return notFound('Agent not found')

  const access = await requireWorkspaceAccess(
    appContext,
    existingAgent.workspaceId,
  )
  if (access instanceof Response) return access

  const permission = await requireWorkspacePermission({
    appContext,
    request: appContext.request,
    workspaceId: existingAgent.workspaceId,
    permissions: workspacePermissions.agentManage,
  })
  if (permission) return permission

  const [agent] = await db
    .update(schema.agent)
    .set({ status })
    .where(
      and(
        eq(schema.agent.id, agentId),
        eq(schema.agent.workspaceId, existingAgent.workspaceId),
      ),
    )
    .returning()
  if (!agent) return notFound('Agent not found')
  return Response.json(toAgent(agent))
}
