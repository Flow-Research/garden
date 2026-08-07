import { Schema } from 'effect'
import {
  ExecutorConnectionsSnapshot,
  type ExecutorConnectionsSnapshot as ExecutorConnectionsSnapshotType,
} from '@/lib/executor-contract'
import { getApiTransport } from './state'

export type IntegrationAction = 'connect' | 'disconnect' | 'delete' | 'resync'

/** Load and decode the complete Executor connections contract. */
export async function listConnections(): Promise<ExecutorConnectionsSnapshotType> {
  const response = await getApiTransport().request<unknown>('/api/connections')
  return Schema.decodeUnknownPromise(ExecutorConnectionsSnapshot)(response)
}

export function mutateConnection(
  integrationSlug: string,
  action: IntegrationAction,
): Promise<{ ok: true }> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(integrationSlug)}`,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    },
  )
}
