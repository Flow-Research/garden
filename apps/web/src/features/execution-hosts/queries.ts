import { infiniteQueryOptions } from '@tanstack/react-query'
import {
  executionHostReadFailure,
  getExecutionHostRun,
  listExecutionHosts,
} from './api'
import { HOST_REPORT_WINDOW_MS } from './status'

/** Half the report window, so a host that stops reporting shows as stale within one further window. */
const SYNC_INTERVAL_MS = HOST_REPORT_WINDOW_MS / 2

export const executionHostKeys = {
  all: (wsId: string) => ['workspaces', wsId, 'execution-hosts'] as const,
  directory: (wsId: string) =>
    [...executionHostKeys.all(wsId), 'directory'] as const,
  run: (wsId: string, launchId: string) =>
    [...executionHostKeys.all(wsId), 'run', launchId] as const,
}

/** A refusal is an answer. Only an outage is worth another attempt. */
const retryOutage = (failureCount: number, error: unknown) =>
  failureCount < 2 && executionHostReadFailure(error) === 'unavailable'

/** Pages through the hosts of one workspace with the directory's own host cursor. */
export function executionHostDirectoryOptions(wsId: string) {
  return infiniteQueryOptions({
    queryKey: executionHostKeys.directory(wsId),
    queryFn: ({ pageParam, signal }) =>
      listExecutionHosts(wsId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextHostId ?? undefined,
    refetchInterval: SYNC_INTERVAL_MS,
    retry: retryOutage,
    staleTime: 0,
  })
}

/** Pages through the events of one launch with the cursor that each snapshot returns. */
export function executionHostRunOptions(wsId: string, launchId: string) {
  return infiniteQueryOptions({
    queryKey: executionHostKeys.run(wsId, launchId),
    queryFn: ({ pageParam, signal }) =>
      getExecutionHostRun(wsId, launchId, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    refetchInterval: SYNC_INTERVAL_MS,
    retry: retryOutage,
    staleTime: 0,
  })
}
