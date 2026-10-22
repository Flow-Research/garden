import {
  Agent,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from 'agents'
import type {
  RealtimePublishableEnvelope,
  RealtimePublishableEvent,
} from '@garden/core/types'
import { createGardenLogger } from '@garden/observability/logger'
import {
  applyRealtimeProfileUpdate,
  canReceiveRealtimeEvent,
  type RealtimeConnectionProfile,
} from './realtime-audience'

type WorkspaceRealtimeConnectionState = RealtimeConnectionProfile & {
  connectedAt: number
}

const realtimeLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'workspace-realtime-do',
})

/**
 * Workspace-scoped realtime hub: one Durable Object per workspace holding
 * hibernating WebSocket connections. API routes publish after successful
 * writes; the hub gates each event per connection (spec §8 audience rules)
 * before sending, so ineligible clients receive nothing.
 */
export class WorkspaceRealtimeDO extends Agent<Cloudflare.Env> {
  shouldSendProtocolMessages() {
    return false
  }

  onConnect(
    connection: Connection<WorkspaceRealtimeConnectionState>,
    ctx: ConnectionContext,
  ) {
    const headers = ctx.request.headers
    const userId = headers.get('x-garden-user-id')
    const role = headers.get('x-garden-role')
    if (!userId || !role) {
      connection.close(4001, 'Unauthorized')
      return
    }
    connection.setState({
      userId,
      role,
      teamIds: parseIdList(headers.get('x-garden-team-ids')),
      ownedTeamIds: parseIdList(headers.get('x-garden-owned-team-ids')),
      connectedAt: Date.now(),
    })
    realtimeLogger.info('realtime.connected', {
      workspaceId: this.name,
      userId,
      role,
      teamCount: parseIdList(headers.get('x-garden-team-ids')).length,
    })
  }

  onMessage(
    _connection: Connection<WorkspaceRealtimeConnectionState>,
    _message: WSMessage,
  ) {}

  onError(connectionOrError: Connection | unknown, error?: unknown) {
    const cause = error ?? connectionOrError
    realtimeLogger.warn('realtime.error', {
      workspaceId: this.name,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }

  /**
   * Delivers one event to every eligible connection. Profile updates run
   * first so membership changes take effect for the same event that announces
   * them.
   */
  async publish(envelope: RealtimePublishableEnvelope): Promise<number> {
    const connections = [...this.getConnections<WorkspaceRealtimeConnectionState>()]
    for (const connection of connections) {
      if (!connection.state) continue
      const updated = applyRealtimeProfileUpdate(
        connection.state,
        envelope satisfies RealtimePublishableEvent,
      )
      if (updated !== connection.state) {
        connection.setState({
          ...updated,
          connectedAt: connection.state.connectedAt,
        })
      }
    }

    let delivered = 0
    for (const connection of connections) {
      if (!connection.state) continue
      if (
        !canReceiveRealtimeEvent(
          connection.state,
          envelope satisfies RealtimePublishableEvent,
        )
      ) {
        continue
      }
      connection.send(JSON.stringify(envelope))
      delivered += 1
    }

    realtimeLogger.info('realtime.delivered', {
      workspaceId: this.name,
      eventId: envelope.event_id,
      type: envelope.type,
      delivered,
      connections: connections.length,
      publishToDeliverMs: Date.now() - envelope.published_at,
    })
    return delivered
  }
}

function parseIdList(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}
