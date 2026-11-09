import { and, eq } from 'drizzle-orm'
import type { AppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { notFound, toAgent } from '@/lib/server/control-plane'
import {
  requireWorkspaceMember,
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

  const access = await requireWorkspaceMember(
    appContext,
    existingAgent.workspaceId,
    workspacePermissions.agentManage,
  )
  if (access instanceof Response) return access

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
