import { toAgent } from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import { listAgentsByWorkspace } from '@/lib/server/queries/agents'

/**
 * Lists agents for a workspace as public DTOs. Used by `GET /api/agents`.
 * Before: select + `toAgent` in the route. After: query + map here.
 */
export async function listWorkspaceAgents(db: Db, workspaceId: string) {
  const rows = await listAgentsByWorkspace(db, workspaceId)
  return rows.map(toAgent)
}
