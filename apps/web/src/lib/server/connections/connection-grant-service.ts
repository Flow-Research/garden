import { Result, type Result as ResultValue } from 'better-result'
import type { Db } from '@/lib/server/db'
import {
  deleteConnectionGrant,
  upsertConnectionGrant,
} from '@/lib/server/queries/connections'
import {
  PermissionGrantError,
  requireAgentInWorkspace,
  type ConnectionScopedTrustLevel,
  type PermissionTrustLevel,
} from './grant-shared'

export { PermissionGrantError as ConnectionGrantError } from './grant-shared'

/**
 * Sets a connection-level permission grant after validating the agent and
 * rejecting connection-scoped `auto` trust.
 */
export function setConnectionGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  trustLevel: PermissionTrustLevel
  grantedBy: string
}): Promise<ResultValue<{ ok: true }, PermissionGrantError>> {
  return Result.gen(async function* () {
    if (input.trustLevel === 'auto') {
      return yield* Result.err(
        new PermissionGrantError({
          status: 400,
          message: 'Auto trust is only available for individual read tools',
        }),
      )
    }
    // Narrow after the auto reject; Result.gen yield* erases control-flow narrowing.
    const trustLevel = input.trustLevel as ConnectionScopedTrustLevel

    yield* Result.await(
      requireAgentInWorkspace({
        db: input.db,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    )

    yield* Result.await(
      Result.tryPromise({
        try: async () =>
          await upsertConnectionGrant(input.db, {
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            connectorId: input.connectorId,
            trustLevel,
            grantedBy: input.grantedBy,
          }),
        catch: () =>
          new PermissionGrantError({
            status: 500,
            message: 'Failed to update permission grant',
          }),
      }),
    )
    return Result.ok({ ok: true as const })
  })
}

/** Deletes a connection-level permission grant when the agent exists. */
export function removeConnectionGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  actorId: string
}): Promise<ResultValue<{ ok: true }, PermissionGrantError>> {
  return Result.gen(async function* () {
    yield* Result.await(
      requireAgentInWorkspace({
        db: input.db,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    )

    yield* Result.await(
      Result.tryPromise({
        try: async () =>
          await deleteConnectionGrant(input.db, {
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            connectorId: input.connectorId,
            actorId: input.actorId,
          }),
        catch: () =>
          new PermissionGrantError({
            status: 500,
            message: 'Failed to delete permission grant',
          }),
      }),
    )
    return Result.ok({ ok: true as const })
  })
}
