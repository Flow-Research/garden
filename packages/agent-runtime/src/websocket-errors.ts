import type { Connection } from 'agents'
import {
  errorFields,
  type GardenLogger,
} from '@garden/observability/logger'

function connectionId(connection: Connection | null) {
  const candidate = connection as { id?: unknown } | null
  return typeof candidate?.id === 'string' ? candidate.id : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isExpectedWebSocketDisconnect(error: unknown) {
  const message = errorMessage(error)
  return (
    message.includes('Network connection lost') ||
    message.includes('This script has been upgraded') ||
    message.includes('Going away') ||
    message.includes('WebSocket')
  )
}

/**
 * Converts Agents SDK websocket lifecycle errors into Garden structured logs.
 * Before this helper, the SDK default `onError(connection, error)` emitted error
 * logs that looked like app failures for expected deploy/network disconnects.
 * After this helper, connection-scoped websocket errors become warn-level,
 * attributed lifecycle events while non-connection agent errors remain error-level.
 * Reference checked: installed `agents` type definitions expose overloaded
 * `onError(connection, error)` / `onError(error)` hooks.
 */
export function logAgentSocketError(args: {
  logger: GardenLogger
  component: string
  connection?: Connection | null
  error: unknown
}) {
  const fields = {
    component: args.component,
    connectionId: connectionId(args.connection ?? null),
    message: errorMessage(args.error),
    ...errorFields(args.error),
  }

  if (args.connection && isExpectedWebSocketDisconnect(args.error)) {
    args.logger.warn('agent.websocket.disconnected', fields)
    return
  }

  if (args.connection) {
    args.logger.warn('agent.websocket.error', fields)
    return
  }

  args.logger.error('agent.runtime.error', fields)
}
