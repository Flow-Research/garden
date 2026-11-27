import { Schema } from 'effect'
import {
  ExecutorConnectionsSnapshot,
  type ExecutorConnectionsSnapshot as ExecutorConnectionsSnapshotType,
} from '@/lib/executor-contract'
import { getApiTransport } from './state'

export type IntegrationAction = 'connect' | 'disconnect' | 'delete' | 'resync'

const ConnectorCallbackEvent = Schema.Struct({
  id: Schema.String,
  connectorId: Schema.String,
  connectorLabel: Schema.String,
  status: Schema.Literals(['success', 'degraded', 'error']),
  message: Schema.NullOr(Schema.String),
})

const ConnectorCallbackEventResponse = Schema.Struct({
  event: ConnectorCallbackEvent,
})

export type ConnectorCallbackEventItem = typeof ConnectorCallbackEvent.Type

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

/** Loads the callback outcome referenced by the signed connector flow URL. */
export async function getConnectorCallbackEvent(args: {
  flowId: string
  connectorId?: string | null
}) {
  const search = new URLSearchParams({ flow_id: args.flowId })
  if (args.connectorId) search.set('connector_id', args.connectorId)
  const response = await getApiTransport().request<unknown>(
    `/api/connections/callback-events?${search.toString()}`,
  )
  return Schema.decodeUnknownPromise(ConnectorCallbackEventResponse)(response)
}
