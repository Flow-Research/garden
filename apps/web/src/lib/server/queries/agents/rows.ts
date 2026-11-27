import { and, eq } from 'drizzle-orm'
import { requireReturnedRow, schema, type Db } from '@/lib/server/db'

export async function listAgentsByWorkspace(db: Db, workspaceId: string) {
  return await db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.workspaceId, workspaceId))
}

export async function getAgentById(db: Db, agentId: string) {
  const [agent] = await db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
  return agent ?? null
}

export async function getAgentWorkspaceHost(
  db: Db,
  agentId: string,
): Promise<{ workspaceId: string; hostName: string | null } | null> {
  const [row] = await db
    .select({
      workspaceId: schema.agent.workspaceId,
      hostName: schema.agent.hostName,
    })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
  return row ?? null
}

export async function insertAgent(
  db: Pick<Db, 'insert'>,
  values: typeof schema.agent.$inferInsert,
) {
  return requireReturnedRow(
    await db.insert(schema.agent).values(values).returning(),
    'agent',
  )
}

export async function updateAgentById(
  db: Db,
  input: {
    agentId: string
    workspaceId: string
    values: Partial<typeof schema.agent.$inferInsert>
  },
) {
  const [agent] = await db
    .update(schema.agent)
    .set(input.values)
    .where(
      and(
        eq(schema.agent.id, input.agentId),
        eq(schema.agent.workspaceId, input.workspaceId),
      ),
    )
    .returning()
  return agent ?? null
}

export async function setAgentRowStatus(
  db: Db,
  input: {
    agentId: string
    workspaceId: string
    status: 'active' | 'archived'
  },
) {
  const [agent] = await db
    .update(schema.agent)
    .set({ status: input.status })
    .where(
      and(
        eq(schema.agent.id, input.agentId),
        eq(schema.agent.workspaceId, input.workspaceId),
      ),
    )
    .returning()
  return agent ?? null
}

export async function listChatThreadIdsForAgent(db: Db, agentId: string) {
  return await db
    .select({ id: schema.chatThread.id })
    .from(schema.chatThread)
    .where(eq(schema.chatThread.agentId, agentId))
}
