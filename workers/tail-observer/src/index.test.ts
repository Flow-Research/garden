import { describe, expect, it } from 'vitest'

import { extractAgentDiagnostics, toOtlpLogs } from './index'

const trace = (
  diagnosticsChannelEvents: Array<{ channel: string; message: unknown }>,
) => ({ diagnosticsChannelEvents }) as TraceItem

describe('tail observer agent diagnostics', () => {
  it('keeps native Agent failure correlation without arbitrary payload fields', () => {
    const [event] = extractAgentDiagnostics(
      trace([
        {
          channel: 'agents:chat',
          message: {
            type: 'chat:request:failed',
            agent: 'ChatSubAgent',
            name: 'runtime-key',
            timestamp: 1_765_000_000_000,
            payload: {
              requestId: 'request-1',
              stage: 'streaming',
              error: { name: 'ProviderError', message: 'provider detail' },
              messages: ['mail body'],
            },
          },
        },
      ]),
    )

    expect(event).toEqual({
      channel: 'agents:chat',
      type: 'chat:request:failed',
      severity: 'error',
      timestamp: 1_765_000_000_000,
      agent: 'ChatSubAgent',
      name: 'runtime-key',
      requestId: 'request-1',
      stage: 'streaming',
      errorName: 'ProviderError',
    })
  })

  it('flags abnormal disconnects while ignoring unrelated diagnostics', () => {
    expect(
      extractAgentDiagnostics(
        trace([
          {
            channel: 'agents:lifecycle',
            message: {
              type: 'disconnect',
              payload: { code: 1_011 },
              timestamp: 1,
            },
          },
          { channel: 'other:channel', message: { type: 'failed' } },
        ]),
      ),
    ).toEqual([
      {
        channel: 'agents:lifecycle',
        type: 'disconnect',
        severity: 'warn',
        timestamp: 1,
        agent: null,
        name: null,
        code: 1_011,
      },
    ])
  })

  it('encodes searchable OTLP log attributes', () => {
    const payload = toOtlpLogs([
      {
        source: 'garden-tail-observer',
        schemaVersion: 1,
        timestamp: '2026-08-14T10:00:00.000Z',
        producerService: 'garden-preview',
        outcome: 'ok',
        trigger: 'rpc',
        message: 'rpc | agents:chat chat:request:failed streaming',
        appEvents: [],
        agentEvents: [
          {
            channel: 'agents:chat',
            type: 'chat:request:failed',
            severity: 'error',
            timestamp: 1,
            agent: 'ChatSubAgent',
            name: 'runtime-key',
          },
        ],
        exceptions: [],
      },
    ])

    expect(payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]).toMatchObject({
      severityText: 'ERROR',
      body: {
        stringValue: 'rpc | agents:chat chat:request:failed streaming',
      },
    })
  })
})
