import type { Connection } from 'agents'
import { describe, expect, it } from 'vitest'
import type {
  GardenLogger,
  GardenLogFields,
  GardenLogLevel,
} from '@garden/observability/logger'
import { logAgentSocketError } from './websocket-errors'

type LoggedRecord = {
  level: GardenLogLevel
  event: string
  fields?: GardenLogFields
}

function createMemoryLogger(records: LoggedRecord[]): GardenLogger {
  return {
    debug: (event, fields) => records.push({ level: 'debug', event, fields }),
    info: (event, fields) => records.push({ level: 'info', event, fields }),
    warn: (event, fields) => records.push({ level: 'warn', event, fields }),
    error: (event, fields) => records.push({ level: 'error', event, fields }),
    child: () => createMemoryLogger(records),
  }
}

/**
 * Exercises the noisy websocket path that previously produced warn records with
 * stack traces and retry metadata for normal client/network disconnects. After
 * the log-level change, expected disconnects stay available for deep debugging
 * without polluting staging warning streams; unexpected socket failures still
 * carry full diagnostics. Source checked: local Agents SDK `onError` overloads
 * route connection-scoped websocket failures through this helper.
 */
describe('logAgentSocketError', () => {
  it('downgrades expected websocket disconnects to compact debug records', () => {
    const records: LoggedRecord[] = []
    const error = new Error('Network connection lost.') as Error & {
      retryable: boolean
    }
    error.retryable = true

    logAgentSocketError({
      logger: createMemoryLogger(records),
      component: 'agent-do',
      connection: { id: 'connection-1' } as Connection,
      error,
    })

    expect(records).toEqual([
      {
        level: 'debug',
        event: 'agent.websocket.disconnected',
        fields: {
          component: 'agent-do',
          connectionId: 'connection-1',
          message: 'Network connection lost.',
        },
      },
    ])
  })

  it('keeps diagnostic fields for unexpected websocket errors', () => {
    const records: LoggedRecord[] = []
    const error = new Error('socket state exploded')

    logAgentSocketError({
      logger: createMemoryLogger(records),
      component: 'chat-sub-agent',
      connection: { id: 'connection-2' } as Connection,
      error,
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      level: 'warn',
      event: 'agent.websocket.error',
      fields: {
        component: 'chat-sub-agent',
        connectionId: 'connection-2',
        message: 'socket state exploded',
        errorName: 'Error',
        errorMessage: 'socket state exploded',
      },
    })
    expect(records[0]?.fields?.errorStack).toContain('socket state exploded')
  })
})
