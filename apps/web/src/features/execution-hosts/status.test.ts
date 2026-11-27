import { describe, expect, it } from 'vitest'
import type {
  HostEvent,
  HostSnapshot,
} from '@garden/core/execution-host/contracts'
import { HOST_REPORT_WINDOW_MS, hostFreshness, runStatus } from './status'

const NOW = 1_800_000_000_000

type StatusInput = Parameters<typeof runStatus>[0]

function input(
  overrides: Partial<Omit<StatusInput, 'latestEvent' | 'host'>> & {
    state?: HostEvent['state']
    lastSeenAt?: number | null
    hostStatus?: HostSnapshot['host']['status']
  } = {},
): StatusInput {
  const { state, lastSeenAt = NOW - 1_000, hostStatus, ...rest } = overrides
  return {
    termination: 'unconfirmed',
    cancellation: 'none',
    deliveryStatus: 'acknowledged',
    latestEvent: state ? ({ state } as HostEvent) : null,
    host: {
      status: hostStatus ?? 'enrolled',
      lastSeenAt,
    } as HostSnapshot['host'],
    ...rest,
  }
}

describe('hostFreshness', () => {
  it('treats a newer host clock as uncertain', () => {
    expect(
      hostFreshness({ status: 'enrolled', lastSeenAt: NOW + 1 }, NOW),
    ).toBe('stale')
  })
  it('reports recent contact only inside the report window', () => {
    const enrolled = { status: 'enrolled' as const }
    expect(
      hostFreshness(
        { ...enrolled, lastSeenAt: NOW - HOST_REPORT_WINDOW_MS },
        NOW,
      ),
    ).toBe('recent')
    expect(
      hostFreshness(
        { ...enrolled, lastSeenAt: NOW - HOST_REPORT_WINDOW_MS - 1 },
        NOW,
      ),
    ).toBe('stale')
    expect(hostFreshness({ ...enrolled, lastSeenAt: null }, NOW)).toBe(
      'never_reported',
    )
    expect(hostFreshness({ status: 'revoked', lastSeenAt: NOW }, NOW)).toBe(
      'revoked',
    )
  })
})

describe('runStatus', () => {
  it('shows a reported state only while the host reports', () => {
    expect(runStatus(input({ state: 'running' }), NOW, true)).toEqual({
      kind: 'reported',
      state: 'running',
    })
    expect(
      runStatus(
        input({
          state: 'running',
          lastSeenAt: NOW - HOST_REPORT_WINDOW_MS - 1,
        }),
        NOW,
        true,
      ),
    ).toEqual({ kind: 'stale', cause: 'stale', lastReported: 'running' })
    expect(
      runStatus(input({ state: 'running', lastSeenAt: null }), NOW, true),
    ).toEqual({
      kind: 'stale',
      cause: 'never_reported',
      lastReported: 'running',
    })
    expect(
      runStatus(input({ state: 'running', hostStatus: 'revoked' }), NOW, true),
    ).toEqual({ kind: 'stale', cause: 'revoked', lastReported: 'running' })
    expect(
      runStatus(
        input({ state: 'running', deliveryStatus: 'revoked' }),
        NOW,
        true,
      ),
    ).toEqual({ kind: 'stale', cause: 'revoked', lastReported: 'running' })
  })

  it('shows an unconfirmed state as unknown after a failed refresh', () => {
    expect(runStatus(input({ state: 'running' }), NOW, false)).toEqual({
      kind: 'unknown',
      lastReported: 'running',
    })
  })

  it('keeps a cancellation request separate from confirmed termination', () => {
    expect(
      runStatus(
        input({ state: 'running', cancellation: 'requested' }),
        NOW,
        true,
      ),
    ).toEqual({ kind: 'cancellation_requested', lastReported: 'running' })
    expect(
      runStatus(
        input({
          state: 'cancelled',
          cancellation: 'requested',
          termination: 'host-confirmed',
        }),
        NOW,
        true,
      ),
    ).toEqual({
      kind: 'finished',
      state: 'cancelled',
      cancellationRequested: true,
    })
  })

  it('keeps a confirmed result when the host is stale or the refresh failed', () => {
    expect(
      runStatus(
        input({
          state: 'succeeded',
          termination: 'host-confirmed',
          lastSeenAt: null,
        }),
        NOW,
        false,
      ),
    ).toEqual({
      kind: 'finished',
      state: 'succeeded',
      cancellationRequested: false,
    })
  })

  it('reports a run that never started and the stages before the first event', () => {
    expect(
      runStatus(
        input({ termination: 'not-started', cancellation: 'requested' }),
        NOW,
        true,
      ),
    ).toEqual({ kind: 'not_started', cancellationRequested: true })
    expect(runStatus(input({ deliveryStatus: 'pending' }), NOW, true)).toEqual({
      kind: 'waiting_for_host',
    })
    expect(runStatus(input(), NOW, true)).toEqual({ kind: 'acknowledged' })
  })

  it('reports unknown when termination and the last event disagree', () => {
    expect(
      runStatus(
        input({ state: 'running', termination: 'host-confirmed' }),
        NOW,
        true,
      ),
    ).toEqual({ kind: 'unknown', lastReported: 'running' })
    expect(runStatus(input({ state: 'failed' }), NOW, true)).toEqual({
      kind: 'unknown',
      lastReported: 'failed',
    })
  })
})
