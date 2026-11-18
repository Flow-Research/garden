import { bindExistingCapabilitiesToAgent as bindFromQueries } from '@/lib/server/queries/agents'
import type { Db, schema } from './db'

/**
 * Compatibility wrapper for default-agent recovery in `chat-agents.ts`.
 * SQL lives in `queries/agents/bindings.ts`; this keeps the prior call shape
 * (`schema` arg ignored) so chat-agents does not need a wider refactor.
 */
export async function bindExistingCapabilitiesToAgent(input: {
  db: Pick<Db, 'select' | 'insert'>
  schema: typeof schema
  agentId: string
  grantedBy: string
}) {
  await bindFromQueries({
    db: input.db,
    agentId: input.agentId,
    grantedBy: input.grantedBy,
  })
}
