import { z } from 'zod'

/**
 * Why a run uses (or does not use) a member's per-member connections.
 * - `triggering_member`: a member commented, mentioned, assigned, or started it.
 * - `delegating_member`: an agent started it while acting for a member (a chat
 *   delegation or a child issue of that member's run).
 * - `no_member`: no member is behind the run (system, webhook, or agent work
 *   with no member upstream). Such runs get no user connections; Executor
 *   org connections stay visible to them.
 */
export const RunConnectorIdentitySchema = z.object({
  userId: z.string().min(1).nullable(),
  basis: z.enum(['triggering_member', 'delegating_member', 'no_member']),
})

export type RunConnectorIdentity = z.infer<typeof RunConnectorIdentitySchema>

const NO_MEMBER: RunConnectorIdentity = { userId: null, basis: 'no_member' }

/**
 * Decides whose per-member connections (Google Drive, Gmail, Slack, ...) an
 * issue run may use. Before #383 every run used the agent owner's
 * connections, so a member's request either failed or ran as the owner's
 * personal account. Now a member actor uses their own connections, an agent
 * actor inherits the member it was delegating for, and anything else gets
 * none. It never substitutes the agent owner or any other person.
 */
export function resolveRunConnectorIdentity(input: {
  actor: { type: 'member' | 'agent' | 'system'; id: string }
  onBehalfOfUserId?: string | null
}): RunConnectorIdentity {
  if (input.actor.type === 'member') {
    return { userId: input.actor.id, basis: 'triggering_member' }
  }
  if (input.actor.type === 'agent' && input.onBehalfOfUserId) {
    return { userId: input.onBehalfOfUserId, basis: 'delegating_member' }
  }
  return NO_MEMBER
}

/**
 * Reads the connector identity recorded on `issue_run.context_snapshot` at
 * queue time. A snapshot without one (runs queued before #383) resolves to no
 * member, so an old run never silently picks up the agent owner's accounts.
 */
export function readRunConnectorIdentity(
  contextSnapshot: unknown,
): RunConnectorIdentity {
  const parsed = z
    .object({ connectorIdentity: RunConnectorIdentitySchema })
    .safeParse(contextSnapshot)
  return parsed.success ? parsed.data.connectorIdentity : NO_MEMBER
}
