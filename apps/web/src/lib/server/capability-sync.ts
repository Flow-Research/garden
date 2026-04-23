import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { Result, TaggedError } from 'better-result'
import { and, eq, inArray } from 'drizzle-orm'
import { getConnectorById } from '@garden/connectors'
import { mintMcpProxyJwt } from '@garden/connectors/proxy-jwt'
import { getDb, schema } from './db'
import { appEnv } from './env'

export class CapabilitySyncError extends TaggedError('CapabilitySyncError')<{
  code:
    | 'connector_not_found'
    | 'proxy_not_configured'
    | 'sync_agent_not_found'
    | 'tool_list_failed'
    | 'unclassified_tool'
    | 'database_failed'
  message: string
}>() {}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    )
  }

  return value
}

function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJson(value ?? null))
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function resolveSyncAgentId(userId: string, workspaceId: string) {
  const db = getDb(appEnv)
  const ownedAgentsResult = await Result.tryPromise({
    try: async () =>
      db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.workspaceId, workspaceId),
            eq(schema.agent.ownerUserId, userId),
          ),
        )
        .limit(1),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to load workspace agents for capability sync',
      }),
  })
  if (ownedAgentsResult.isErr()) return ownedAgentsResult

  const ownedAgent = ownedAgentsResult.value[0]
  if (ownedAgent) {
    return Result.ok(ownedAgent.id)
  }

  const fallbackAgentsResult = await Result.tryPromise({
    try: async () =>
      db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(eq(schema.agent.workspaceId, workspaceId))
        .limit(1),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to load workspace agents for capability sync',
      }),
  })
  if (fallbackAgentsResult.isErr()) return fallbackAgentsResult

  const fallbackAgent = fallbackAgentsResult.value[0]
  return fallbackAgent
    ? Result.ok(fallbackAgent.id)
    : Result.err(
        new CapabilitySyncError({
          code: 'sync_agent_not_found',
          message:
            'Capability sync requires at least one workspace agent to exist',
        }),
      )
}

function defaultTrustLevelForRisk(riskClass: string | null) {
  switch (riskClass) {
    case 'read':
      return 'auto' as const
    case 'write':
      return 'allow' as const
    default:
      return 'ask' as const
  }
}

async function seedDefaultPermissionGrants(args: {
  capabilities: Array<{
    id: string
    riskClass: string | null
  }>
  userId: string
  workspaceId: string
}) {
  if (args.capabilities.length === 0) {
    return Result.ok(undefined)
  }

  const db = getDb(appEnv)
  const agentsResult = await Result.tryPromise({
    try: async () =>
      db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(eq(schema.agent.workspaceId, args.workspaceId)),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to load workspace agents for permission defaults',
      }),
  })
  if (agentsResult.isErr()) return agentsResult

  const agentIds = agentsResult.value.map((agent) => agent.id)
  if (agentIds.length === 0) {
    return Result.ok(undefined)
  }

  const capabilityIds = args.capabilities.map((capability) => capability.id)
  const existingGrantsResult = await Result.tryPromise({
    try: async () =>
      db
        .select({
          agentId: schema.permissionGrant.agentId,
          capabilityId: schema.permissionGrant.capabilityId,
        })
        .from(schema.permissionGrant)
        .where(
          and(
            inArray(schema.permissionGrant.agentId, agentIds),
            inArray(schema.permissionGrant.capabilityId, capabilityIds),
          ),
        ),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to load existing permission grants',
      }),
  })
  if (existingGrantsResult.isErr()) return existingGrantsResult

  const existingGrantKeys = new Set(
    existingGrantsResult.value.map(
      (grant) => `${grant.agentId}:${grant.capabilityId}`,
    ),
  )

  const missingGrants = agentIds.flatMap((agentId) =>
    args.capabilities.flatMap((capability) => {
      const key = `${agentId}:${capability.id}`
      if (existingGrantKeys.has(key)) {
        return []
      }

      return [
        {
          id: crypto.randomUUID(),
          agentId,
          capabilityId: capability.id,
          trustLevel: defaultTrustLevelForRisk(capability.riskClass),
          grantedBy: args.userId,
          grantedAt: new Date(),
          expiresAt: null,
        } satisfies typeof schema.permissionGrant.$inferInsert,
      ]
    }),
  )

  if (missingGrants.length === 0) {
    return Result.ok(undefined)
  }

  return Result.tryPromise({
    try: async () => {
      await db.insert(schema.permissionGrant).values(missingGrants).onConflictDoNothing()
    },
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to seed default permission grants',
      }),
  })
}

async function deleteStaleCapabilityDependencies(staleCapabilityIds: string[]) {
  if (staleCapabilityIds.length === 0) {
    return Result.ok(undefined)
  }

  const db = getDb(appEnv)
  return Result.tryPromise({
    try: async () => {
      await db
        .delete(schema.permissionGrant)
        .where(inArray(schema.permissionGrant.capabilityId, staleCapabilityIds))
      await db
        .delete(schema.permissionRequest)
        .where(inArray(schema.permissionRequest.capabilityId, staleCapabilityIds))
      await db
        .delete(schema.toolCallAudit)
        .where(inArray(schema.toolCallAudit.capabilityId, staleCapabilityIds))
      await db
        .delete(schema.invocationLog)
        .where(inArray(schema.invocationLog.capabilityId, staleCapabilityIds))
    },
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to prune stale capability dependencies',
      }),
  })
}

function buildProxyTransport(args: {
  connectorId: string
  proxyBaseUrl: string
  transport: 'streamable-http' | 'sse'
  bearerToken: string
}) {
  const url =
    args.transport === 'streamable-http'
      ? new URL(`/${args.connectorId}/mcp`, args.proxyBaseUrl)
      : new URL(`/${args.connectorId}/sse`, args.proxyBaseUrl)

  const requestInit = {
    headers: {
      Authorization: `Bearer ${args.bearerToken}`,
    },
  }

  return args.transport === 'streamable-http'
    ? new StreamableHTTPClientTransport(url, { requestInit })
    : new SSEClientTransport(url, { requestInit })
}

async function listConnectorTools(args: {
  connectorId: string
  proxyBaseUrl: string
  bearerToken: string
  transport: 'streamable-http' | 'sse'
}) {
  const client = new Client(
    {
      name: 'garden-capability-sync',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  )
  const transport = buildProxyTransport(args)

  return Result.tryPromise({
    try: async () =>
      client
        .connect(transport)
        .then(() => client.listTools())
        .then((result) => result.tools)
        .finally(() => client.close()),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'tool_list_failed',
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to list tools for ${args.connectorId}`,
      }),
  })
}

async function toCapabilityValue(args: {
  connectorId: string
  tool: Tool
}) {
  const connector = getConnectorById(args.connectorId)
  const classification = connector?.tools[args.tool.name]

  if (!connector || !classification) {
    return Result.err(
      new CapabilitySyncError({
        code: 'unclassified_tool',
        message: `Tool ${args.tool.name} is not classified in ${args.connectorId}`,
      }),
    )
  }

  const inputSchema = args.tool.inputSchema ?? null

  return Result.ok({
    id: crypto.randomUUID(),
    connectorType: args.connectorId,
    name: args.tool.name,
    description:
      classification.descriptionOverride ?? args.tool.description ?? null,
    inputSchema,
    outputSchema: args.tool.outputSchema ?? null,
    schemaHash: await sha256Hex(canonicalJsonString(inputSchema)),
    requiredScopes: classification.requiredScopes,
    riskClass: classification.riskClass,
  } satisfies typeof schema.capability.$inferInsert)
}

export async function syncCapabilities(
  connectorId: string,
  userId: string,
  workspaceId: string,
) {
  const connector = getConnectorById(connectorId)
  if (!connector) {
    return Result.err(
      new CapabilitySyncError({
        code: 'connector_not_found',
        message: `Unknown connector: ${connectorId}`,
      }),
    )
  }

  if (!appEnv.MCP_PROXY_URL) {
    return Result.err(
      new CapabilitySyncError({
        code: 'proxy_not_configured',
        message: 'MCP_PROXY_URL must be configured before syncing capabilities',
      }),
    )
  }

  const syncAgentIdResult = await resolveSyncAgentId(userId, workspaceId)
  if (syncAgentIdResult.isErr()) return syncAgentIdResult

  const tokenResult = await Result.tryPromise({
    try: async () =>
      mintMcpProxyJwt({
        secret: appEnv.BETTER_AUTH_SECRET,
        sub: userId,
        workspaceId,
        agentId: syncAgentIdResult.value,
        connectorId,
      }),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'tool_list_failed',
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to mint proxy token for ${connectorId}`,
      }),
  })
  if (tokenResult.isErr()) return tokenResult

  const toolsResult = await listConnectorTools({
    connectorId,
    proxyBaseUrl: appEnv.MCP_PROXY_URL,
    bearerToken: tokenResult.value,
    transport: connector.upstream.transport,
  })
  if (toolsResult.isErr()) return toolsResult

  const capabilityRows: Array<typeof schema.capability.$inferInsert> = []
  for (const tool of toolsResult.value) {
    const capabilityResult = await toCapabilityValue({
      connectorId,
      tool,
    })
    if (capabilityResult.isErr()) return capabilityResult
    capabilityRows.push(capabilityResult.value)
  }

  const db = getDb(appEnv)
  const upsertResult = await Result.tryPromise({
    try: async () => {
      for (const capability of capabilityRows) {
        await db
          .insert(schema.capability)
          .values(capability)
          .onConflictDoUpdate({
            target: [schema.capability.connectorType, schema.capability.name],
            set: {
              description: capability.description,
              inputSchema: capability.inputSchema,
              outputSchema: capability.outputSchema,
              schemaHash: capability.schemaHash,
              requiredScopes: capability.requiredScopes,
              riskClass: capability.riskClass,
            },
          })
      }
    },
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to upsert capabilities for ${connectorId}`,
      }),
  })
  if (upsertResult.isErr()) return upsertResult

  const toolNames = capabilityRows.map((capability) => capability.name)
  const existingCapabilitiesResult = await Result.tryPromise({
    try: async () =>
      db
        .select({
          id: schema.capability.id,
          name: schema.capability.name,
          riskClass: schema.capability.riskClass,
        })
        .from(schema.capability)
        .where(eq(schema.capability.connectorType, connectorId)),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to load existing capabilities for ${connectorId}`,
      }),
  })
  if (existingCapabilitiesResult.isErr()) return existingCapabilitiesResult

  const staleCapabilityIds = existingCapabilitiesResult.value
    .filter((capability) => !toolNames.includes(capability.name))
    .map((capability) => capability.id)

  const staleDependencyCleanupResult =
    await deleteStaleCapabilityDependencies(staleCapabilityIds)
  if (staleDependencyCleanupResult.isErr()) {
    return staleDependencyCleanupResult
  }

  if (staleCapabilityIds.length > 0) {
    const deleteResult = await Result.tryPromise({
      try: async () =>
        db
          .delete(schema.capability)
          .where(inArray(schema.capability.id, staleCapabilityIds)),
      catch: (cause) =>
        new CapabilitySyncError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to prune stale capabilities for ${connectorId}`,
        }),
    })
    if (deleteResult.isErr()) return deleteResult
  }

  const defaultGrantResult = await seedDefaultPermissionGrants({
    capabilities: existingCapabilitiesResult.value
      .filter((capability) => !staleCapabilityIds.includes(capability.id))
      .map((capability) => ({
        id: capability.id,
        riskClass: capability.riskClass,
      })),
    userId,
    workspaceId,
  })
  if (defaultGrantResult.isErr()) return defaultGrantResult

  return Result.ok(undefined)
}
