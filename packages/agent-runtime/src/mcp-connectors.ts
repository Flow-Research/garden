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

export type WarmConnectorServerCheck = {
  registeredServerIds: string[]
  storedRows: StoredConnectorServerRow[]
  now?: number
}

const CONNECTOR_ID_ALIASES: Record<string, string> = {
  exa_search: 'exa-search',
  google_drive: 'google-drive',
}

export function normalizeMcpConnectorId(connectorId: string) {
  const normalized = connectorId.trim()
  return CONNECTOR_ID_ALIASES[normalized] ?? normalized
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
  registeredServerIds?: Set<string>
  stored: StoredConnectorServerRow | undefined
  now: number
  refreshWindowMs: number
}) {
  if (!args.stored) return true
  if (args.stored.accountId !== args.binding.accountId) return true
  if (
    args.registeredServerIds &&
    !args.registeredServerIds.has(args.stored.serverId)
  ) {
    return true
  }

  return (
    Date.parse(args.stored.jwtExpiresAt) - args.now <= args.refreshWindowMs
  )
}

export function buildConnectorSyncPlan(args: {
  bindings: ActiveConnectorBinding[]
  registeredServerIds?: string[]
  storedRows: StoredConnectorServerRow[]
  now?: number
  refreshWindowMs?: number
}): ConnectorSyncPlan {
  const now = args.now ?? Date.now()
  const refreshWindowMs =
    args.refreshWindowMs ?? MCP_PROXY_JWT_REFRESH_WINDOW_MS
  const activeConnectorIds = new Set(
    args.bindings.map((binding) => binding.connectorId),
  )
  const storedByConnector = new Map(
    args.storedRows.map((row) => [row.connectorId, row]),
  )
  const registeredServerIds = args.registeredServerIds
    ? new Set(args.registeredServerIds)
    : undefined

  return {
    connectorIdsToRemove: args.storedRows
      .filter((row) => !activeConnectorIds.has(row.connectorId))
      .map((row) => row.connectorId),
    bindingsToRefresh: args.bindings.filter((binding) =>
      shouldRefreshStoredBinding({
        binding,
        registeredServerIds,
        stored: storedByConnector.get(binding.connectorId),
        now,
        refreshWindowMs,
      }),
    ),
  }
}

export function hasWarmStoredConnectorServers(args: WarmConnectorServerCheck) {
  if (args.storedRows.length === 0) return false

  const now = args.now ?? Date.now()
  const registeredServerIds = new Set(args.registeredServerIds)

  return args.storedRows.every((row) => {
    if (!registeredServerIds.has(row.serverId)) return false

    return (
      Date.parse(row.jwtExpiresAt) - now >
      MCP_PROXY_JWT_REFRESH_WINDOW_MS
    )
  })
}
