import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Result, TaggedError } from 'better-result'
import { access, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  isNativeConnector,
  type ConnectorMcpSpec,
  type ConnectorSpec,
} from '@garden/connectors/sdk'

type RegisteredConnector = ConnectorSpec

class ConnectorCoverageError extends TaggedError('ConnectorCoverageError')<{
  connectorId: string
  message: string
}>() {}

class UpstreamToolListError extends TaggedError('UpstreamToolListError')<{
  connectorId: string
  message: string
}>() {}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort()
}

/**
 * Keeps connector verification self-contained now that the generated connector
 * scaffolder package is gone. Before, this script imported tool-listing helpers
 * from the removed connector generator; after the cleanup it owns the small MCP
 * probe directly so coverage checks remain available without a CLI package.
 */
function buildUpstreamHeaders(connector: ConnectorMcpSpec) {
  const headers = new Headers(connector.upstream.headers ?? {})
  const apiKeyEnvVar = connector.apiKey?.envVar
  const apiKeyHeaderName = connector.apiKey?.headerName
  const apiKeyValue = apiKeyEnvVar ? process.env[apiKeyEnvVar]?.trim() : null
  const bearerToken = process.env[bearerTokenEnvVarName(connector.id)]?.trim()

  if (apiKeyHeaderName && apiKeyValue) {
    headers.set(apiKeyHeaderName, apiKeyValue)
  }

  if (bearerToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${bearerToken}`)
  }

  return headers
}

/**
 * Selects the MCP client transport declared by each connector manifest. This is
 * intentionally script-local so connector manifests stay data-only and the old
 * scaffolder does not survive just to support coverage verification.
 */
function buildUpstreamTransport(connector: ConnectorMcpSpec) {
  const requestInit = {
    headers: buildUpstreamHeaders(connector),
  }
  const url = new URL(connector.upstream.mcpServerUrl)

  return connector.upstream.transport === 'streamable-http'
    ? new StreamableHTTPClientTransport(url, { requestInit })
    : new SSEClientTransport(url, { requestInit })
}

/**
 * Fetches live upstream MCP tool names for a connector manifest. The observed
 * old behavior depended on the removed generator package; the intended behavior
 * is equivalent coverage verification with no package scaffold dependency.
 */
async function listUpstreamToolNames(connector: ConnectorMcpSpec) {
  const client = new Client(
    {
      name: 'garden-connector-tool-list',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  )
  const transport = buildUpstreamTransport(connector)

  const toolsResult = await Result.tryPromise({
    try: async () =>
      client
        .connect(transport)
        .then(() => client.listTools())
        .then((result) => result.tools.map((tool) => tool.name))
        .finally(() => client.close()),
    catch: (cause) =>
      new UpstreamToolListError({
        connectorId: connector.id,
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to list tools for ${connector.id}`,
      }),
  })
  if (toolsResult.isErr()) {
    return toolsResult
  }

  return Result.ok(uniqueSorted(toolsResult.value))
}

function compareTools(connector: RegisteredConnector, expectedTools: string[]) {
  const manifestTools = uniqueSorted(Object.keys(connector.tools))
  const missingTools = expectedTools.filter(
    (tool) => !manifestTools.includes(tool),
  )
  const extraTools = manifestTools.filter(
    (tool) => !expectedTools.includes(tool),
  )

  if (missingTools.length === 0 && extraTools.length === 0) {
    return Result.ok({
      connectorId: connector.id,
      toolCount: manifestTools.length,
    })
  }

  const parts = [
    missingTools.length > 0 ? `missing: ${missingTools.join(', ')}` : '',
    extraTools.length > 0 ? `extra: ${extraTools.join(', ')}` : '',
  ].filter(Boolean)

  return Result.err(
    new ConnectorCoverageError({
      connectorId: connector.id,
      message: `Connector tool coverage mismatch (${parts.join(' | ')})`,
    }),
  )
}

function bearerTokenEnvVarName(connectorId: string) {
  return `${connectorId.replaceAll('-', '_').toUpperCase()}_MCP_BEARER_TOKEN`
}

function hasUpstreamCredentials(connector: ConnectorMcpSpec) {
  const apiKeyEnvVar = (connector as { apiKey?: { envVar?: string } }).apiKey
    ?.envVar
  const hasOAuth = Boolean((connector as { oauth?: unknown }).oauth)

  if (apiKeyEnvVar) {
    return Boolean(process.env[apiKeyEnvVar]?.trim())
  }

  if (hasOAuth) {
    return Boolean(process.env[bearerTokenEnvVarName(connector.id)]?.trim())
  }

  // No auth required at all (public upstream) — still probe.
  return true
}

async function verifyConnector(connector: RegisteredConnector) {
  if (isNativeConnector(connector)) {
    return Result.ok({
      connectorId: connector.id,
      toolCount: Object.keys(connector.tools).length,
      skipped: true as const,
    })
  }

  if (!hasUpstreamCredentials(connector)) {
    console.warn(
      `${connector.id}: skipped — no upstream credentials in env (set ${bearerTokenEnvVarName(connector.id)} or the connector apiKey env var to enforce)`,
    )
    return Result.ok({
      connectorId: connector.id,
      toolCount: Object.keys(connector.tools).length,
      skipped: true as const,
    })
  }

  const upstreamTools = await listUpstreamToolNames(connector)
  if (upstreamTools.isErr()) {
    return Result.err(
      new ConnectorCoverageError({
        connectorId: connector.id,
        message: upstreamTools.error.message,
      }),
    )
  }

  return compareTools(connector, upstreamTools.value)
}

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const connectorsRoot = resolve(scriptDir, '..', 'src')

async function loadConnectorRegistry() {
  const directoryEntriesResult = await Result.tryPromise({
    try: async () => readdir(connectorsRoot, { withFileTypes: true }),
    catch: () =>
      new ConnectorCoverageError({
        connectorId: 'registry',
        message: 'Failed to read connectors directory',
      }),
  })
  if (directoryEntriesResult.isErr()) {
    return directoryEntriesResult
  }

  const connectorIds = directoryEntriesResult.value
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()

  const connectors: RegisteredConnector[] = []
  for (const connectorId of connectorIds) {
    const connectorPath = join(connectorsRoot, connectorId, 'connector.ts')
    const existsResult = await Result.tryPromise({
      try: async () => access(connectorPath),
      catch: () => null,
    })
    if (existsResult.isErr()) {
      continue
    }

    const moduleResult = await Result.tryPromise({
      try: async () =>
        import(pathToFileURL(connectorPath).href) as Promise<{
          default: RegisteredConnector
        }>,
      catch: (cause) =>
        new ConnectorCoverageError({
          connectorId,
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to import ${connectorId} connector manifest`,
        }),
    })
    if (moduleResult.isErr()) {
      return moduleResult
    }

    connectors.push(moduleResult.value.default)
  }

  return Result.ok(connectors as readonly RegisteredConnector[])
}

function resolveConnectorsFromArgs(args: string[]) {
  return async () => {
    const registryResult = await loadConnectorRegistry()
    if (registryResult.isErr()) {
      return registryResult
    }

    if (args.length === 0) {
      return registryResult
    }

    const connectorsById = new Map(
      registryResult.value.map((connector) => [connector.id, connector]),
    )
    const resolved: RegisteredConnector[] = []
    for (const connectorId of uniqueSorted(args)) {
      const connector = connectorsById.get(connectorId)
      if (!connector) {
        return Result.err(
          new ConnectorCoverageError({
            connectorId,
            message: 'Unknown connector id',
          }),
        )
      }

      resolved.push(connector)
    }

    return Result.ok(resolved as readonly RegisteredConnector[])
  }
}

async function main() {
  const connectorsResult = await resolveConnectorsFromArgs(
    process.argv.slice(2),
  )()
  if (connectorsResult.isErr()) {
    console.error(
      `${connectorsResult.error.connectorId}: ${connectorsResult.error.message}`,
    )
    process.exitCode = 1
    return
  }

  const results = await Promise.all(connectorsResult.value.map(verifyConnector))
  const failures = results.flatMap((result) => (result.isErr() ? [result] : []))

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`${failure.error.connectorId}: ${failure.error.message}`)
    }

    process.exitCode = 1
    return
  }

  for (const result of results) {
    if (result.isOk()) {
      const label =
        'skipped' in result.value && result.value.skipped
          ? 'manifest-only (no upstream probe)'
          : `verified ${result.value.toolCount} tools`
      console.log(`${result.value.connectorId}: ${label}`)
    }
  }
}

await main()
