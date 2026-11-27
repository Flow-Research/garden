import { toAgent } from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import { listAgentsByWorkspace } from '@/lib/server/queries/agents'

/** Lists a workspace's agents as public DTOs for `GET /api/agents`. */
export async function listWorkspaceAgents(db: Db, workspaceId: string) {
  const rows = await listAgentsByWorkspace(db, workspaceId)
  return rows.map(toAgent)
}
