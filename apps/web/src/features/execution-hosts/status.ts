import type {
  HostEvent,
  HostSnapshot,
  HostSummary,
} from '@garden/core/execution-host/contracts'

/**
 * A host counts as recently reported for two signed-request windows.
 * `HOST_REQUEST_WINDOW_MS` in `packages/core/src/execution-host/generated/host-auth.ts`
 * is 60 s, and the contract defines no polling cadence, so this is a starting
 * value for display only. It never gates an effect.
 */
export const HOST_REPORT_WINDOW_MS = 120_000

export type HostFreshness = 'revoked' | 'never_reported' | 'stale' | 'recent'

/** Classifies the last signed contact of a host against the time of the read. It does not promise availability. */
export function hostFreshness(
  host: Pick<HostSummary, 'status' | 'lastSeenAt'>,
  observedAt: number,
): HostFreshness {
  if (host.status === 'revoked') return 'revoked'
  if (host.lastSeenAt === null) return 'never_reported'
  return observedAt - host.lastSeenAt > HOST_REPORT_WINDOW_MS
    ? 'stale'
    : 'recent'
}

type TerminalState = Extract<
  HostEvent['state'],
  'succeeded' | 'failed' | 'cancelled'
>
type ActiveState = Exclude<HostEvent['state'], TerminalState>

export type RunStatus =
  /** The host never started the run: cancelled before dispatch, or declined by the host. */
  | { kind: 'not_started'; cancellationRequested: boolean }
  /** The host confirmed that the process ended. */
  | { kind: 'finished'; state: TerminalState; cancellationRequested: boolean }
  /** A member asked for cancellation. The host has not confirmed termination. */
  | { kind: 'cancellation_requested'; lastReported: ActiveState | null }
  | { kind: 'waiting_for_host' }
  | { kind: 'acknowledged' }
  /** The last report is recent enough to show as the current state. */
  | { kind: 'reported'; state: ActiveState }
  /** The host has not reported recently, so its last state is not current. */
  | {
      kind: 'stale'
      cause: Exclude<HostFreshness, 'recent'>
      lastReported: ActiveState | null
    }
  /** The stored facts do not agree, or the last refresh failed. */
  | { kind: 'unknown'; lastReported: HostEvent['state'] | null }

const isTerminal = (state: HostEvent['state']): state is TerminalState =>
  state === 'succeeded' || state === 'failed' || state === 'cancelled'

/**
 * Derives the one state the page shows for a run. `synchronized` is false when
 * the last refresh failed. A non-terminal state then shows as unknown.
 */
export function runStatus(
  snapshot: Pick<
    HostSnapshot,
    'termination' | 'cancellation' | 'deliveryStatus' | 'latestEvent' | 'host'
  >,
  observedAt: number,
  synchronized: boolean,
): RunStatus {
  const cancellationRequested = snapshot.cancellation === 'requested'
  const last = snapshot.latestEvent?.state ?? null
  if (snapshot.termination === 'not-started')
    return { kind: 'not_started', cancellationRequested }
  if (snapshot.termination === 'host-confirmed')
    return last !== null && isTerminal(last)
      ? { kind: 'finished', state: last, cancellationRequested }
      : { kind: 'unknown', lastReported: last }
  if (last !== null && isTerminal(last))
    return { kind: 'unknown', lastReported: last }
  if (!synchronized) return { kind: 'unknown', lastReported: last }
  if (cancellationRequested)
    return { kind: 'cancellation_requested', lastReported: last }
  const freshness = hostFreshness(snapshot.host, observedAt)
  if (freshness !== 'recent' || snapshot.deliveryStatus === 'revoked')
    return {
      kind: 'stale',
      cause: freshness === 'recent' ? 'revoked' : freshness,
      lastReported: last,
    }
  if (last !== null) return { kind: 'reported', state: last }
  return snapshot.deliveryStatus === 'acknowledged'
    ? { kind: 'acknowledged' }
    : { kind: 'waiting_for_host' }
}
