import { Result, type Result as ResultValue } from 'better-result'
import type { Db } from '@/lib/server/db'
import {
  deleteToolPermissionGrant,
  getCapabilityByConnectorTool,
  upsertToolPermissionGrant,
} from '@/lib/server/queries/connections'
import {
  PermissionGrantError,
  requireAgentInWorkspace,
  type PermissionTrustLevel,
} from './grant-shared'

export { PermissionGrantError as ToolGrantError } from './grant-shared'

/**
 * Sets a tool-level permission grant after validating the agent, tool, and
 * `auto` trust (read tools only).
 */
export function setToolGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  toolName: string
  trustLevel: PermissionTrustLevel
  grantedBy: string
}): Promise<ResultValue<{ ok: true }, PermissionGrantError>> {
  return Result.gen(async function* () {
    yield* Result.await(
      requireAgentInWorkspace({
        db: input.db,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    )

    const capability = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          await getCapabilityByConnectorTool(input.db, {
            connectorId: input.connectorId,
            toolName: input.toolName,
          }),
        catch: () =>
          new PermissionGrantError({
            status: 500,
            message: 'Failed to load tool capability for permission grant',
          }),
      }),
    )
    if (!capability) {
      return yield* Result.err(
        new PermissionGrantError({
          status: 404,
          message: 'Tool not found',
        }),
      )
    }

    if (input.trustLevel === 'auto' && capability.riskClass !== 'read') {
      return yield* Result.err(
        new PermissionGrantError({
          status: 400,
          message: 'Auto trust is only available for read tools',
        }),
      )
    }

    yield* Result.await(
      Result.tryPromise({
        try: async () =>
          await upsertToolPermissionGrant(input.db, {
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            capabilityId: capability.id,
            connectorId: input.connectorId,
            toolName: input.toolName,
            trustLevel: input.trustLevel,
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

/** Deletes a tool-level permission grant when the agent exists. */
export function removeToolGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  toolName: string
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
          await deleteToolPermissionGrant(input.db, {
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            connectorId: input.connectorId,
            toolName: input.toolName,
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
