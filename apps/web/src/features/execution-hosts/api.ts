import {
  hostDirectorySchema,
  hostSnapshotSchema,
  type HostDirectory,
  type HostSnapshot,
} from '@garden/core/execution-host/contracts'
import { ApiError, getApiTransport } from '@/lib/api'

/**
 * The receiver answers 503 with this text while `ENGINEERING_PILOT_OPERATOR_ID`
 * is unset (`requireFreshPilot` in `apps/web/src/lib/server/execution-hosts.ts`).
 * Other 503 answers mean an outage, so the text is the only discriminator.
 */
const PILOT_DISABLED_MESSAGE = 'The engineering pilot is not configured'

export type ExecutionHostReadFailure =
  | 'disabled'
  | 'signed_out'
  | 'refused'
  | 'not_found'
  | 'unavailable'

/** Maps a failed read to the state the page shows. Nothing here grants access: the server already refused. */
export function executionHostReadFailure(
  error: unknown,
): ExecutionHostReadFailure {
  if (!(error instanceof ApiError)) return 'unavailable'
  if (error.status === 503 && error.message === PILOT_DISABLED_MESSAGE)
    return 'disabled'
  if (error.status === 401) return 'signed_out'
  if (error.status === 403) return 'refused'
  if (error.status === 404) return 'not_found'
  return 'unavailable'
}

/** A page of server data and the browser time at which it arrived. */
export type Synchronized<T> = T & { receivedAt: number }

/**
 * The explicit header binds each read to the workspace in its query key. The
 * receiver refuses a request without it and never falls back to the active
 * organization.
 */
function read(path: string, workspaceId: string, signal?: AbortSignal) {
  return getApiTransport().request<unknown>(path, {
    contentType: null,
    headers: { 'X-Workspace-ID': workspaceId },
    signal,
  })
}

/** Reads one page of the hosts enrolled in `workspaceId`. */
export async function listExecutionHosts(
  workspaceId: string,
  afterHostId?: string,
  signal?: AbortSignal,
): Promise<Synchronized<HostDirectory>> {
  const query = afterHostId
    ? `?afterHostId=${encodeURIComponent(afterHostId)}`
    : ''
  const payload = await read(
    `/api/execution-hosts/${query}`,
    workspaceId,
    signal,
  )
  const directory = hostDirectorySchema.parse(payload)
  if (directory.workspaceId !== workspaceId)
    throw new ApiError({
      message: 'Host directory belongs to another workspace',
      status: 409,
      statusText: 'Conflict',
    })
  return { ...directory, receivedAt: Date.now() }
}

/** Reads the run state and the event page after `afterSequence` for one launch in `workspaceId`. */
export async function getExecutionHostRun(
  workspaceId: string,
  launchId: string,
  afterSequence: number,
  signal?: AbortSignal,
): Promise<Synchronized<HostSnapshot>> {
  const payload = await read(
    `/api/execution-hosts/runs/${encodeURIComponent(launchId)}/?after=${afterSequence}`,
    workspaceId,
    signal,
  )
  const snapshot = hostSnapshotSchema.parse(payload)
  if (snapshot.workspaceId !== workspaceId || snapshot.launchId !== launchId)
    throw new ApiError({
      message: 'Run snapshot belongs to another workspace or launch',
      status: 409,
      statusText: 'Conflict',
    })
  return { ...snapshot, receivedAt: Date.now() }
}
