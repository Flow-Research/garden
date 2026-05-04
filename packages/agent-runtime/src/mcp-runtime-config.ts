import { MCP_PROXY_JWT_TTL_SECONDS as DEFAULT_MCP_PROXY_JWT_TTL_SECONDS } from '@garden/connectors/proxy-jwt'

export const mcpRuntimeConfig = {
  proxyJwtTtlSeconds: DEFAULT_MCP_PROXY_JWT_TTL_SECONDS,
  proxyJwtRefreshIntervalSeconds: 30 * 60,
  proxyJwtRefreshSlackSeconds: 5 * 60,
} as const

export const MCP_PROXY_JWT_PERIODIC_REFRESH_WINDOW_MS =
  (mcpRuntimeConfig.proxyJwtRefreshIntervalSeconds +
    mcpRuntimeConfig.proxyJwtRefreshSlackSeconds) *
  1000
