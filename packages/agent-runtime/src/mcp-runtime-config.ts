import { MCP_PROXY_JWT_TTL_SECONDS as DEFAULT_MCP_PROXY_JWT_TTL_SECONDS } from '@garden/connectors/proxy-jwt'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const MCP_CONNECTOR_SETTLE_TIMEOUT_MS = 2 * MINUTE_MS

export const mcpRuntimeConfig = {
  proxyJwtTtlSeconds: DEFAULT_MCP_PROXY_JWT_TTL_SECONDS,
  connectorFullSyncIntervalMs: MINUTE_MS,
  connectionWaitTimeoutMs: MCP_CONNECTOR_SETTLE_TIMEOUT_MS,
  connectorDiscoveryTimeoutMs: MCP_CONNECTOR_SETTLE_TIMEOUT_MS,
  connectorDiscoveryWaitTimeoutMs: MCP_CONNECTOR_SETTLE_TIMEOUT_MS,
  connectorDiscoveryCancellationRetryDelaysMs: [500, 1_500, 3_500],
} as const
