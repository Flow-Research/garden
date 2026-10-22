import { and, eq } from 'drizzle-orm'
import type {
  RealtimePublishableEnvelope,
  RealtimePublishableEvent,
} from '@garden/core/types'
import { createGardenLogger } from '@garden/observability/logger'
import { createSessionAuth } from '@/lib/auth'
import { schema } from '@/lib/server/db'
import {
  createAppRequestContext,
  getLoggedAuthSession,
} from '@/lib/server/context'
import type { AppEnv } from '@/lib/server/env'

const realtimeLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'realtime',
})

/** Publishes to the workspace hub after a successful write; never rejects. */
export function publishWorkspaceEvent(
  env: AppEnv,
  workspaceId: string,
  event: RealtimePublishableEvent,
): Promise<void> {
  // Route tests build a partial env; without the binding there is no hub.
  if (!env.WORKSPACE_REALTIME) return Promise.resolve()

  const envelope = {
    ...event,
    event_id: crypto.randomUUID(),
    workspace_id: workspaceId,
    published_at: Date.now(),
  } as RealtimePublishableEnvelope

  const stub = env.WORKSPACE_REALTIME.get(
    env.WORKSPACE_REALTIME.idFromName(workspaceId),
  )
  return stub
    .publish(envelope)
    .then(() => {
      realtimeLogger.info('realtime.published', {
        workspaceId,
        eventId: envelope.event_id,
        type: envelope.type,
      })
    })
    .catch((cause: unknown) => {
      realtimeLogger.warn('realtime.publish_failed', {
        workspaceId,
        type: event.type,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    })
}

/**
 * Authenticates a realtime WebSocket upgrade, resolves the caller's trusted
 * audience profile (role, Team memberships, owned Teams), and forwards the
 * upgrade to the workspace hub. Headers are only ever set here, after auth.
 */
export async function handleRealtimeConnect(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Upgrade required', { status: 426 })
  }

  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId) {
    return new Response('workspace_id required', { status: 400 })
  }

  const auth = await createSessionAuth(env, request)
  const session = await getLoggedAuthSession({
    auth,
    request,
    source: 'route-helper',
    fields: { route: 'realtime' },
  })
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const appContext = createAppRequestContext(env, request)
  const db = await appContext.db()
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        eq(schema.member.userId, session.user.id),
      ),
    )
  if (!membership) {
    await appContext.close()
    return new Response('Forbidden', { status: 403 })
  }

  const teamMemberships = await db
    .select({ teamId: schema.teamMember.teamId })
    .from(schema.teamMember)
    .where(
      and(
        eq(schema.teamMember.workspaceId, workspaceId),
        eq(schema.teamMember.userId, session.user.id),
      ),
    )
  const ownedTeams = await db
    .select({ teamId: schema.team.id })
    .from(schema.team)
    .where(
      and(
        eq(schema.team.workspaceId, workspaceId),
        eq(schema.team.ownerUserId, session.user.id),
      ),
    )
  await appContext.close()

  const headers = new Headers(request.headers)
  headers.set('x-garden-user-id', session.user.id)
  headers.set('x-garden-role', membership.role)
  headers.set('x-garden-team-ids', teamMemberships.map((row) => row.teamId).join(','))
  headers.set('x-garden-owned-team-ids', ownedTeams.map((row) => row.teamId).join(','))

  const stub = env.WORKSPACE_REALTIME.get(
    env.WORKSPACE_REALTIME.idFromName(workspaceId),
  )
  return stub.fetch(new Request(request, { headers }))
}
