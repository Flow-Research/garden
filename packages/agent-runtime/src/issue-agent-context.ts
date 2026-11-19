import { Result } from 'better-result'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'

const GENERATION_SEPARATOR = ':ctx'

/**
 * Names the `IssueRunSubAgent` facet that holds an issue's agent context.
 * Generation 0 is the bare issue id, so facets created before generations
 * existed keep their address and their retained history.
 */
export function issueRunFacetName(issueId: string, generation: number) {
  return generation === 0
    ? issueId
    : `${issueId}${GENERATION_SEPARATOR}${generation}`
}

/** Inverse of `issueRunFacetName`: the issue an issue-run facet belongs to. */
export function issueIdFromFacetName(facetName: string) {
  const separator = facetName.indexOf(GENERATION_SEPARATOR)
  return separator === -1 ? facetName : facetName.slice(0, separator)
}

export const ISSUE_CONTEXT_RESET_MESSAGE =
  'Started a fresh agent context. Earlier agent history on this issue could not be verified under current Brain permissions and is kept for review.'

/** The agent's context generation on an issue; no row means generation 0. */
export async function readIssueAgentContextGeneration(
  db: Db,
  key: { issueId: string; agentId: string },
) {
  return Result.tryPromise(async () => {
    const [row] = await db
      .select({ generation: schema.issueAgentContext.generation })
      .from(schema.issueAgentContext)
      .where(issueAgentContextKey(key))
      .limit(1)
    return row?.generation ?? 0
  })
}

function issueAgentContextKey(key: { issueId: string; agentId: string }) {
  return and(
    eq(schema.issueAgentContext.issueId, key.issueId),
    eq(schema.issueAgentContext.agentId, key.agentId),
  )
}

/**
 * Moves one agent on an issue to its next context generation, at most once per
 * run. Other agents on the issue keep their generation. The context row lock, the compare-and-set from `observedGeneration`, and the
 * `issue_run:context_reset` event commit together, so a Workflow step retry
 * converges: it either finds this run's reset event and returns the current
 * generation unchanged, or a concurrent bump already moved the issue on.
 * Returns the generation the run should start on; when it equals
 * `observedGeneration`, this run already had its one fresh context.
 */
export async function resetIssueAgentContext(
  db: Db,
  input: {
    issueId: string
    agentId: string
    runId: string
    observedGeneration: number
  },
) {
  return Result.tryPromise(
    async () =>
      await db.transaction(async (tx) => {
        // Same per-run lock as every other run event insert, so `seq` stays unique.
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${input.runId}::text, 0))
        `)
        const [issue] = await tx
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, input.issueId))
          .limit(1)
        if (!issue) throw new Error(`Issue ${input.issueId} not found.`)
        // Insert-if-missing first so the row lock below always has a row,
        // even when two runs reach generation 0 at the same time.
        await tx
          .insert(schema.issueAgentContext)
          .values({ issueId: input.issueId, agentId: input.agentId })
          .onConflictDoNothing()
        const [context] = (await tx
          .select({ generation: schema.issueAgentContext.generation })
          .from(schema.issueAgentContext)
          .where(issueAgentContextKey(input))
          .for('update')) as [{ generation: number }]
        const [existing] = await tx
          .select({ id: schema.issueRunEvent.id })
          .from(schema.issueRunEvent)
          .where(
            and(
              eq(schema.issueRunEvent.runId, input.runId),
              eq(schema.issueRunEvent.eventType, 'issue_run:context_reset'),
            ),
          )
          .limit(1)
        if (existing || context.generation !== input.observedGeneration)
          return context.generation
        const next = context.generation + 1
        await tx
          .update(schema.issueAgentContext)
          .set({ generation: next })
          .where(issueAgentContextKey(input))
        const [{ nextSeq }] = (await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(eq(schema.issueRunEvent.runId, input.runId))) as [
          { nextSeq: number },
        ]
        await tx.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: issue.workspaceId,
          issueId: input.issueId,
          runId: input.runId,
          seq: nextSeq,
          eventType: 'issue_run:context_reset',
          stream: 'system',
          level: 'info',
          message: ISSUE_CONTEXT_RESET_MESSAGE,
          payload: {
            from_generation: input.observedGeneration,
            to_generation: next,
          },
        })
        return next
      }),
  )
}
