import { Schema } from 'effect'
import {
  HarnessyConnectionsSnapshot,
  type HarnessyConnectionsSnapshot as HarnessyConnectionsSnapshotType,
} from '@/lib/harnessy-contract'
import { getApiTransport } from './state'

export type IntegrationAction = 'connect' | 'disconnect' | 'delete' | 'resync'

/** Load and decode the complete Harnessy connections contract. */
export async function listConnections(): Promise<HarnessyConnectionsSnapshotType> {
  const response = await getApiTransport().request<unknown>('/api/connections')
  return Schema.decodeUnknownPromise(HarnessyConnectionsSnapshot)(response)
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
