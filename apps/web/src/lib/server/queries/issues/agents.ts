import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * True when the agent exists in the workspace. Used before starting an issue
 * run so a stale assignee id cannot kick a run in another workspace.
 */
export async function agentExistsInWorkspace(
  db: Db,
  input: { workspaceId: string; agentId: string },
): Promise<boolean> {
  const [agent] = await db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.id, input.agentId),
        eq(schema.agent.workspaceId, input.workspaceId),
      ),
    )
    .limit(1)
  return Boolean(agent)
}
