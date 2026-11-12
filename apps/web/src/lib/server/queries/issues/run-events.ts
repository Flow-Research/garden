import { eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Lists issue run events joined to the run's agent id for the timeline API.
 */
export async function listIssueRunEventsWithAgent(db: Db, issueId: string) {
  return await db
    .select({
      event: schema.issueRunEvent,
      agentId: schema.issueRun.agentId,
    })
    .from(schema.issueRunEvent)
    .innerJoin(
      schema.issueRun,
      eq(schema.issueRun.id, schema.issueRunEvent.runId),
    )
    .where(eq(schema.issueRunEvent.issueId, issueId))
}
