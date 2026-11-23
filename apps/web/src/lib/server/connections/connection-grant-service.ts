import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { Db } from '@/lib/server/db'
import { agentExistsInWorkspace } from '@/lib/server/queries/issues/agents'
import {
  deleteConnectionGrant,
  upsertConnectionGrant,
} from '@/lib/server/queries/connections'

export class ConnectionGrantError extends TaggedError('ConnectionGrantError')<{
  message: string
  status: number
}>() {}

type TrustLevel = 'auto' | 'allow' | 'ask'

/**
 * Connection-level grant PATCH/DELETE orchestration. Permission and connector
 * existence stay in the route. Before: SQL in grant route. After: Result
 * service over queries.
 */
export async function setConnectionGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  trustLevel: TrustLevel
  grantedBy: string
}): Promise<ResultValue<{ ok: true }, ConnectionGrantError>> {
  if (input.trustLevel === 'auto') {
    return Result.err(
      new ConnectionGrantError({
        status: 400,
        message: 'Auto trust is only available for individual read tools',
      }),
    )
  }

  const existsResult = await Result.tryPromise({
    try: async () =>
      await agentExistsInWorkspace(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    catch: () =>
      new ConnectionGrantError({
        status: 500,
        message: 'Failed to load agent for permission grant',
      }),
  })
  if (existsResult.isErr()) return Result.err(existsResult.error)
  if (!existsResult.value) {
    return Result.err(
      new ConnectionGrantError({
        status: 404,
        message: 'Agent not found',
      }),
    )
  }

  const mutation = await Result.tryPromise({
    try: async () =>
      await upsertConnectionGrant(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        connectorId: input.connectorId,
        trustLevel: input.trustLevel,
        grantedBy: input.grantedBy,
      }),
    catch: () =>
      new ConnectionGrantError({
        status: 500,
        message: 'Failed to update permission grant',
      }),
  })
  if (mutation.isErr()) return Result.err(mutation.error)
  return Result.ok({ ok: true })
}

export async function removeConnectionGrant(input: {
  db: Db
  workspaceId: string
  agentId: string
  connectorId: string
  actorId: string
}): Promise<ResultValue<{ ok: true }, ConnectionGrantError>> {
  const existsResult = await Result.tryPromise({
    try: async () =>
      await agentExistsInWorkspace(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    catch: () =>
      new ConnectionGrantError({
        status: 500,
        message: 'Failed to load agent for permission grant',
      }),
  })
  if (existsResult.isErr()) return Result.err(existsResult.error)
  if (!existsResult.value) {
    return Result.err(
      new ConnectionGrantError({
        status: 404,
        message: 'Agent not found',
      }),
    )
  }

  const mutation = await Result.tryPromise({
    try: async () =>
      await deleteConnectionGrant(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        connectorId: input.connectorId,
        actorId: input.actorId,
      }),
    catch: () =>
      new ConnectionGrantError({
        status: 500,
        message: 'Failed to delete permission grant',
      }),
  })
  if (mutation.isErr()) return Result.err(mutation.error)
  return Result.ok({ ok: true })
}
