import type { ConnectorSpec } from './sdk.ts'
import exaSearchConnector from './exa-search/connector'
import githubConnector from './github/connector'
import gmailConnector from './gmail/connector'
import googleDriveConnector from './google-drive/connector'
import slackConnector from './slack/connector'

export const connectorRegistry = [
  exaSearchConnector,
  githubConnector,
  gmailConnector,
  googleDriveConnector,
  slackConnector,
] as const satisfies readonly ConnectorSpec[]

export type RegisteredConnector = (typeof connectorRegistry)[number]
export type ConnectorId = RegisteredConnector['id']

export const connectorsById = new Map(
  connectorRegistry.map((connector) => [connector.id, connector]),
)

export function getConnectorById(id: string) {
  return connectorsById.get(id)
}

export default connectorRegistry
