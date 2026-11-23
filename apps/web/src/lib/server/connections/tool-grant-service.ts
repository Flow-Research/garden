import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { Db } from '@/lib/server/db'
import { agentExistsInWorkspace } from '@/lib/server/queries/issues/agents'
import {
  deleteToolPermissionGrant,
  getCapabilityByConnectorTool,
  upsertToolPermissionGrant,
} from '@/lib/server/queries/connections'

export class ToolGrantError extends TaggedError('ToolGrantError')<{
  message: string
  status: number
}>() {}

type TrustLevel = 'auto' | 'allow' | 'ask'

/**
 * Tool-level grant PATCH/DELETE. Permission stays in the route; PostHog after
 * successful set stays in the route. Before: SQL in tools/$name/grant route.
 */
export async function setToolGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  toolName: string
  trustLevel: TrustLevel
  grantedBy: string
}): Promise<ResultValue<{ ok: true }, ToolGrantError>> {
  const existsResult = await Result.tryPromise({
    try: async () =>
      await agentExistsInWorkspace(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    catch: () =>
      new ToolGrantError({
        status: 500,
        message: 'Failed to load agent for permission grant',
      }),
  })
  if (existsResult.isErr()) return Result.err(existsResult.error)
  if (!existsResult.value) {
    return Result.err(
      new ToolGrantError({
        status: 404,
        message: 'Agent not found',
      }),
    )
  }

  const capabilityResult = await Result.tryPromise({
    try: async () =>
      await getCapabilityByConnectorTool(input.db, {
        connectorId: input.connectorId,
        toolName: input.toolName,
      }),
    catch: () =>
      new ToolGrantError({
        status: 500,
        message: 'Failed to load tool capability for permission grant',
      }),
  })
  if (capabilityResult.isErr()) return Result.err(capabilityResult.error)
  const capability = capabilityResult.value
  if (!capability) {
    return Result.err(
      new ToolGrantError({
        status: 404,
        message: 'Tool not found',
      }),
    )
  }

  if (input.trustLevel === 'auto' && capability.riskClass !== 'read') {
    return Result.err(
      new ToolGrantError({
        status: 400,
        message: 'Auto trust is only available for read tools',
      }),
    )
  }

  const mutation = await Result.tryPromise({
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
      new ToolGrantError({
        status: 500,
        message: 'Failed to update permission grant',
      }),
  })
  if (mutation.isErr()) return Result.err(mutation.error)
  return Result.ok({ ok: true })
}

export async function removeToolGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  toolName: string
  actorId: string
}): Promise<ResultValue<{ ok: true }, ToolGrantError>> {
  const existsResult = await Result.tryPromise({
    try: async () =>
      await agentExistsInWorkspace(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    catch: () =>
      new ToolGrantError({
        status: 500,
        message: 'Failed to load agent for permission grant',
      }),
  })
  if (existsResult.isErr()) return Result.err(existsResult.error)
  if (!existsResult.value) {
    return Result.err(
      new ToolGrantError({
        status: 404,
        message: 'Agent not found',
      }),
    )
  }

  const mutation = await Result.tryPromise({
    try: async () =>
      await deleteToolPermissionGrant(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        connectorId: input.connectorId,
        toolName: input.toolName,
        actorId: input.actorId,
      }),
    catch: () =>
      new ToolGrantError({
        status: 500,
        message: 'Failed to delete permission grant',
      }),
  })
  if (mutation.isErr()) return Result.err(mutation.error)
  return Result.ok({ ok: true })
}
