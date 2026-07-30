import type { ConnectorSpec } from './sdk.ts'
import githubConnector from './github/connector'
import gmailConnector from './gmail/connector'
import googleDriveConnector from './google-drive/connector'
import slackConnector from './slack/connector'

/**
 * Exa deliberately is not here. It was an MCP connector whose every call took a
 * DO hop through `McpProxySession`, which bought session persistence, per-turn
 * discovery, and a permission lookup for a read-only API with no per-user auth
 * and no scopes — and whose replayed-then-never-cleared upstream session id was
 * breaking web search outright. Web search now lives as a first-party tool in
 * `@garden/agent-runtime` (`agent-tools/web.ts`) calling `api.exa.ai` directly.
 * Connectors are for per-user authorized third-party accounts; a workspace-level
 * API key is not that.
 */
export const connectorRegistry = [
  githubConnector,
  gmailConnector,
  googleDriveConnector,
  slackConnector,
] as const satisfies readonly ConnectorSpec[]

export type RegisteredConnector = (typeof connectorRegistry)[number]
export type ConnectorId = RegisteredConnector['id']

export const connectorsById = new Map<string, RegisteredConnector>(
  connectorRegistry.map((connector) => [connector.id, connector]),
)

export function getConnectorById(id: string) {
  return connectorsById.get(id)
}

export default connectorRegistry
