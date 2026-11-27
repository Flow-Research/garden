import { eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Lists chat threads in a workspace with their agent host names.
 * Used by `PATCH /api/workspaces/$id` after a workspace update so prompt
 * configs can refresh without the route importing Drizzle.
 */
export async function listWorkspaceChatThreadHosts(
  db: Db,
  workspaceId: string,
) {
  return await db
    .select({
      id: schema.chatThread.id,
      hostName: schema.agent.hostName,
    })
    .from(schema.chatThread)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.chatThread.agentId))
    .where(eq(schema.chatThread.workspaceId, workspaceId))
}
