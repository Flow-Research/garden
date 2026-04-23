export const MCP_PROXY_JWT_REFRESH_WINDOW_MS = 60 * 1000

export type ActiveConnectorBinding = {
  connectorId: string
  accountId: string | null
}

export type StoredConnectorServerRow = {
  connectorId: string
  serverId: string
  accountId: string | null
  jwtExpiresAt: string
  toolsSignature: string | null
}

export type ConnectorSyncPlan = {
  connectorIdsToRemove: string[]
  bindingsToRefresh: ActiveConnectorBinding[]
}

export function extractThreadIdFromAgentName(agentName: string) {
  const normalized = agentName.trim()
  if (!normalized) return null

  return normalized.startsWith('chat:')
    ? normalized.slice('chat:'.length).trim() || null
    : normalized
}

function shouldRefreshStoredBinding(args: {
  binding: ActiveConnectorBinding
  stored: StoredConnectorServerRow | undefined
  now: number
}) {
  if (!args.stored) return true
  if (args.stored.accountId !== args.binding.accountId) return true

  return (
    Date.parse(args.stored.jwtExpiresAt) - args.now <=
    MCP_PROXY_JWT_REFRESH_WINDOW_MS
  )
}

export function buildConnectorSyncPlan(args: {
  bindings: ActiveConnectorBinding[]
  storedRows: StoredConnectorServerRow[]
  now?: number
}): ConnectorSyncPlan {
  const now = args.now ?? Date.now()
  const activeConnectorIds = new Set(
    args.bindings.map((binding) => binding.connectorId),
  )
  const storedByConnector = new Map(
    args.storedRows.map((row) => [row.connectorId, row]),
  )

  return {
    connectorIdsToRemove: args.storedRows
      .filter((row) => !activeConnectorIds.has(row.connectorId))
      .map((row) => row.connectorId),
    bindingsToRefresh: args.bindings.filter((binding) =>
      shouldRefreshStoredBinding({
        binding,
        stored: storedByConnector.get(binding.connectorId),
        now,
      }),
    ),
  }
}
