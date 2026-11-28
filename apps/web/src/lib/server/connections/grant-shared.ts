import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { Db } from '@/lib/server/db'
import { agentExistsInWorkspace } from '@/lib/server/queries/issues/agents'
import { badRequest, json, notFound } from '@/lib/server/control-plane'

/** Trust values stored on connection and tool permission grants. */
export type PermissionTrustLevel = 'auto' | 'allow' | 'ask'

/** Connection-scoped grants never accept `auto` (read-tool only). */
export type ConnectionScopedTrustLevel = Exclude<PermissionTrustLevel, 'auto'>

/** Shared HTTP-mappable failure for connection and tool grant services. */
export class PermissionGrantError extends TaggedError('PermissionGrantError')<{
  message: string
  status: number
}>() {}

/** Maps a grant service error to the route Response shape. */
export function permissionGrantToResponse(error: PermissionGrantError) {
  if (error.status === 404) return notFound(error.message)
  if (error.status === 400) return badRequest(error.message)
  return json({ error: error.message }, error.status)
}

/** Ensures the agent belongs to the workspace before a grant mutation. */
export function requireAgentInWorkspace(input: {
  db: Db
  workspaceId: string
  agentId: string
}): Promise<ResultValue<void, PermissionGrantError>> {
  return Result.gen(async function* () {
    const exists = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          await agentExistsInWorkspace(input.db, {
            workspaceId: input.workspaceId,
            agentId: input.agentId,
          }),
        catch: () =>
          new PermissionGrantError({
            status: 500,
            message: 'Failed to load agent for permission grant',
          }),
      }),
    )
    if (!exists) {
      return yield* Result.err(
        new PermissionGrantError({
          status: 404,
          message: 'Agent not found',
        }),
      )
    }
    return Result.ok(undefined)
  })
}
