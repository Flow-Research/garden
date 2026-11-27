import type {
  HostDirectory,
  HostEvent,
  HostSnapshot,
  HostSummary,
} from '@garden/core/execution-host/contracts'

export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
export const HOST_ID = '33333333-3333-4333-8333-333333333333'
export const LAUNCH_ID = '44444444-4444-4444-8444-444444444444'
export const NOW = 1_800_000_000_000
const SOURCE_REVISION = 'b'.repeat(40)

export function hostSummary(overrides: Partial<HostSummary> = {}): HostSummary {
  return {
    hostId: HOST_ID,
    workspaceId: WORKSPACE_ID,
    agent: 'claude-code',
    repositories: ['garden', 'workstream'],
    capabilityDigest: 'a'.repeat(64),
    keyGeneration: 3,
    status: 'enrolled',
    lastSeenAt: NOW - 5_000,
    ...overrides,
  }
}

export function hostDirectory(
  hosts: HostSummary[],
  overrides: Partial<HostDirectory> = {},
): HostDirectory {
  return {
    kind: 'hosts',
    workspaceId: WORKSPACE_ID,
    observedAt: NOW,
    hosts,
    nextHostId: null,
    ...overrides,
  }
}

export function hostEvent(
  sequence: number,
  overrides: Partial<HostEvent> = {},
): HostEvent {
  return {
    contractVersion: 'harnessy.execution-host.v1',
    hostId: HOST_ID,
    workspaceId: WORKSPACE_ID,
    launchId: LAUNCH_ID,
    runId: LAUNCH_ID,
    sequence,
    at: NOW - 60_000 + sequence,
    state: 'running',
    reason: 'worker_active',
    sourceRevision: SOURCE_REVISION,
    ...overrides,
  }
}

/** Builds a snapshot page that satisfies the cursor rules of `hostSnapshotSchema`. */
export function hostSnapshot(
  events: HostEvent[],
  overrides: Partial<HostSnapshot> = {},
): HostSnapshot {
  const lastSequence = overrides.lastSequence ?? events.at(-1)?.sequence ?? 0
  const nextCursor = overrides.nextCursor ?? events.at(-1)?.sequence ?? 0
  return {
    kind: 'snapshot',
    workspaceId: WORKSPACE_ID,
    launchId: LAUNCH_ID,
    hostId: HOST_ID,
    runId: LAUNCH_ID,
    job: {
      schema: 'harnessy.engineering.job.v1',
      id: '55555555-5555-4555-8555-555555555555',
      objective: 'status-view-fixture',
      taskId: '66666666-6666-4666-8666-666666666666',
      taskRevision: 'c'.repeat(64),
      workspace: WORKSPACE_ID,
      repository: 'garden',
      lane: 'native',
      sourceRevision: SOURCE_REVISION,
      evaluatorDigest: 'd'.repeat(64),
      workloadDigest: 'e'.repeat(64),
    },
    host: hostSummary(),
    deliveryStatus: 'acknowledged',
    lastSequence,
    cancellation: 'none',
    termination: 'unconfirmed',
    nextCursor,
    hasMore: nextCursor < lastSequence,
    latestEvent:
      lastSequence === 0
        ? null
        : (events.find((event) => event.sequence === lastSequence) ??
          hostEvent(lastSequence)),
    events,
    ...overrides,
  }
}
