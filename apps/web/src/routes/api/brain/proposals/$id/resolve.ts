import { Effect, Result as EffectResult } from 'effect'
import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { Kind, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { archiveInboxItemsByKey } from '@garden/db/inbox'
import { requireAppRequestContext } from '@/lib/server/context'
import type { AppRequestContext } from '@/lib/server/context'
import { json, requireWorkspaceContext } from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import type { AppEnv } from '@/lib/server/env'
import { parseJsonBody } from '@/lib/server/validation/common'
import {
  brainWriteBackCanonicalKey,
  brainWriteBackClaimHash,
} from '@garden/agent-runtime/src/brain-write-back-identity'

const resolveBodySchema = z
  .object({ action: z.enum(['approve', 'reject']) })
  .strict()

const archiveForUser = async (args: {
  db: Db
  workspaceId: string
  proposalId: string
}) => {
  await archiveInboxItemsByKey({
    db: args.db,
    workspaceId: args.workspaceId,
    itemKeys: [`brain_proposal:${args.proposalId}`],
  })
}

/**
 * Locks the proposal through the brain write so another decision or proposal
 * cannot take its pending claim. The old early approval released that claim;
 * a failed write could then make rollback violate the pending unique index.
 * PostgreSQL row locks and the partial unique index provide the order; see
 * packages/db/src/schema/brain-telemetry.ts and lib/server/teams.ts.
 */
export const resolveBrainProposal = async ({
  context,
  request,
  params,
}: {
  context: AppRequestContext
  request: Request
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const bodyResult = await parseJsonBody(
    request,
    resolveBodySchema,
    'Invalid proposal action',
  )
  if (bodyResult.isErr()) {
    return json({ error: bodyResult.error.message }, 400)
  }

  const db = await appContext.db()
  const action = bodyResult.value.action
  const env = appEnv as AppEnv & {
    HELIX_URL?: string
    HELIX_API_KEY?: string
  }
  const approveLayer =
    action === 'approve' && env.HELIX_URL !== undefined
      ? makeWebBrainLive({
          baseUrl: env.HELIX_URL,
          apiKey: env.HELIX_API_KEY,
          ai: env.AI,
          files: env.BRAIN_FILES,
        })
      : null
  const resolution = await Result.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.brainWriteProposal)
          .where(
            and(
              eq(schema.brainWriteProposal.id, params.id),
              eq(
                schema.brainWriteProposal.workspaceId,
                workspaceContext.workspaceId,
              ),
            ),
          )
          .for('update')

        if (
          row === undefined ||
          (row.scope.kind === 'user' &&
            row.scope.userId !== workspaceContext.session.user.id)
        ) {
          return { kind: 'missing' as const }
        }
        if (row.status !== 'pending') {
          return { kind: 'decided' as const, status: row.status, id: row.id }
        }
        if (action === 'approve' && approveLayer === null) {
          return { kind: 'unavailable' as const }
        }

        if (approveLayer !== null) {
          // Older rows keep their original run-specific hash for database history.
          const claimHash = await brainWriteBackClaimHash(row.scope, row.claim)
          const writeResult = await Effect.runPromise(
            Effect.result(
              Effect.flatMap(Brain, (brain) =>
                brain.addText({
                  tenantId: WorkspaceId.make(row.workspaceId),
                  label: row.claim.slice(0, 80),
                  body: row.claim,
                  kind: Kind.make(row.kind),
                  scope: row.scope,
                  canonical: {
                    type: 'brain-write-back-claim',
                    value: brainWriteBackCanonicalKey(
                      row.workspaceId,
                      claimHash,
                    ),
                  },
                  actor: {
                    _tag: 'Agent',
                    agentId: 'brain-write-back',
                    runId: row.runId,
                  },
                }),
              ).pipe(Effect.provide(approveLayer)),
            ),
          )
          if (EffectResult.isFailure(writeResult)) {
            return { kind: 'write_failed' as const }
          }
        }

        const status = action === 'approve' ? 'approved' : 'rejected'
        await tx
          .update(schema.brainWriteProposal)
          .set({
            status,
            decidedBy: workspaceContext.session.user.id,
            decidedAt: new Date(),
          })
          .where(eq(schema.brainWriteProposal.id, row.id))
        return { kind: 'decided' as const, status, id: row.id }
      }),
    catch: (cause) => cause,
  })

  return await resolution.match({
    err: async () => json({ error: 'Could not resolve proposal' }, 500),
    ok: async (outcome) => {
      if (outcome.kind === 'missing') {
        return json({ error: 'Proposal not found' }, 404)
      }
      if (outcome.kind === 'unavailable') {
        return json({ error: 'Brain is not configured' }, 503)
      }
      if (outcome.kind === 'write_failed') {
        return json({ error: 'Could not write to the brain' }, 502)
      }
      await archiveForUser({
        db,
        workspaceId: workspaceContext.workspaceId,
        proposalId: outcome.id,
      })
      return json({ ok: true, status: outcome.status })
    },
  })
}

export const Route = createFileRoute('/api/brain/proposals/$id/resolve')({
  server: {
    handlers: {
      POST: resolveBrainProposal,
    },
  },
})
