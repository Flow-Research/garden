import { Effect, Schema } from 'effect'
import { and, eq, inArray } from 'drizzle-orm'
import { getConnectorById } from '@garden/connectors'
import { isNativeConnector } from '@garden/connectors/sdk'
import {
  canonicalJsonString,
  defaultTrustLevelForRisk,
} from '@garden/connectors/capabilities'
import { getDb, schema } from './db'
import { appEnv } from './env'

export class CapabilitySyncError extends Schema.Error<CapabilitySyncError>(
  'CapabilitySyncError',
)({
  code: Schema.Literals([
    'connector_not_found',
    'sync_agent_not_found',
    'tool_list_failed',
    'unclassified_tool',
    'database_failed',
    'schema_hash_failed',
  ]),
  message: Schema.String,
}) {}

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

const sha256Hex = Effect.fn('CapabilitySync.sha256')(function* (value: string) {
  const digest = yield* Effect.tryPromise({
    try: async () =>
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'schema_hash_failed',
        message: errorMessage(cause, 'Failed to hash the capability schema'),
      }),
  })

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
})

const seedDefaultPermissionGrants = Effect.fn(
  'CapabilitySync.seedDefaultPermissionGrants',
)(function* (args: {
  capabilities: Array<{
    id: string
    riskClass: string | null
  }>
  userId: string
  workspaceId: string
}) {
  if (args.capabilities.length === 0) return

  const db = yield* Effect.tryPromise({
    try: async () => getDb(appEnv),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message: errorMessage(cause, 'Failed to open the capability database'),
      }),
  })
  const agents = yield* Effect.tryPromise({
    try: async () =>
      db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(eq(schema.agent.workspaceId, args.workspaceId)),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message: errorMessage(
          cause,
          'Failed to load workspace agents for permission defaults',
        ),
      }),
  })

  const agentIds = agents.map((agent) => agent.id)
  if (agentIds.length === 0) return

  const capabilityIds = args.capabilities.map((capability) => capability.id)
  const existingGrants = yield* Effect.tryPromise({
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
        message: errorMessage(
          cause,
          'Failed to load existing permission grants',
        ),
      }),
  })

  const existingGrantKeys = new Set(
    existingGrants.map((grant) => `${grant.agentId}:${grant.capabilityId}`),
  )
  const missingGrants = agentIds.flatMap((agentId) =>
    args.capabilities.flatMap((capability) => {
      const key = `${agentId}:${capability.id}`
      if (existingGrantKeys.has(key)) return []

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

  if (missingGrants.length === 0) return

  yield* Effect.tryPromise({
    try: async () => {
      await db
        .insert(schema.permissionGrant)
        .values(missingGrants)
        .onConflictDoNothing()
    },
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message: errorMessage(
          cause,
          'Failed to seed default permission grants',
        ),
      }),
  })
})

const deleteStaleCapabilityDependencies = Effect.fn(
  'CapabilitySync.deleteStaleDependencies',
)(function* (staleCapabilityIds: string[]) {
  if (staleCapabilityIds.length === 0) return

  const db = yield* Effect.tryPromise({
    try: async () => getDb(appEnv),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message: errorMessage(cause, 'Failed to open the capability database'),
      }),
  })
  yield* Effect.tryPromise({
    try: async () => {
      await db
        .delete(schema.permissionGrant)
        .where(inArray(schema.permissionGrant.capabilityId, staleCapabilityIds))
      await db
        .delete(schema.permissionRequest)
        .where(
          inArray(schema.permissionRequest.capabilityId, staleCapabilityIds),
        )
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
        message: errorMessage(
          cause,
          'Failed to prune stale capability dependencies',
        ),
      }),
  })
})

function dedupeCapabilityRows(
  rows: Array<typeof schema.capability.$inferInsert>,
) {
  return Array.from(
    rows
      .reduce(
        (capabilitiesByName, row) => capabilitiesByName.set(row.name, row),
        new Map<string, typeof schema.capability.$inferInsert>(),
      )
      .values(),
  ).sort((firstCapability, secondCapability) =>
    firstCapability.name.localeCompare(secondCapability.name),
  )
}

type CapabilityToolLike = {
  name: string
  description?: string | null
  inputSchema?: unknown
  outputSchema?: unknown
}

const toCapabilityValue = Effect.fn('CapabilitySync.toCapabilityValue')(
  function* (args: { connectorId: string; tool: CapabilityToolLike }) {
    const connector = getConnectorById(args.connectorId)
    const classification = connector?.tools[args.tool.name]

    if (!connector || !classification) {
      return yield* new CapabilitySyncError({
        code: 'unclassified_tool',
        message: `Tool ${args.tool.name} is not classified in ${args.connectorId}`,
      })
    }

    const inputSchema = args.tool.inputSchema ?? null
    return {
      id: crypto.randomUUID(),
      connectorType: args.connectorId,
      name: args.tool.name,
      description:
        classification.descriptionOverride ?? args.tool.description ?? null,
      inputSchema,
      outputSchema: args.tool.outputSchema ?? null,
      schemaHash: yield* sha256Hex(canonicalJsonString(inputSchema)),
      requiredScopes: classification.requiredScopes,
      riskClass: classification.riskClass,
    } satisfies typeof schema.capability.$inferInsert
  },
)

export const syncCapabilities = Effect.fn('CapabilitySync.sync')(function* (
  connectorId: string,
  userId: string,
  workspaceId: string,
) {
  const connector = getConnectorById(connectorId)
  if (!connector || connector.id !== connectorId) {
    return yield* new CapabilitySyncError({
      code: 'connector_not_found',
      message: `Unknown connector: ${connectorId}`,
    })
  }

  if (!isNativeConnector(connector)) return

  const discoveredCapabilityRows: Array<typeof schema.capability.$inferInsert> =
    []
  const nativeToolsByName = new Map(
    connector.native.tools.map((tool) => [tool.name, tool]),
  )
  for (const [toolName, classification] of Object.entries(connector.tools)) {
    const nativeTool = nativeToolsByName.get(toolName)
    discoveredCapabilityRows.push(
      yield* toCapabilityValue({
        connectorId,
        tool: nativeTool ?? {
          name: toolName,
          description:
            classification.descriptionOverride ??
            `${connector.label} hosted MCP tool.`,
        },
      }),
    )
  }
  const capabilityRows = dedupeCapabilityRows(discoveredCapabilityRows)

  const db = yield* Effect.tryPromise({
    try: async () => getDb(appEnv),
    catch: (cause) =>
      new CapabilitySyncError({
        code: 'database_failed',
        message: errorMessage(cause, 'Failed to open the capability database'),
      }),
  })
  yield* Effect.forEach(
    capabilityRows,
    (capability) =>
      Effect.tryPromise({
        try: async () =>
          db
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
            }),
        catch: (cause) =>
          new CapabilitySyncError({
            code: 'database_failed',
            message: errorMessage(
              cause,
              `Failed to upsert capabilities for ${connectorId}`,
            ),
          }),
      }),
    { concurrency: 8, discard: true },
  )

  const toolNames = capabilityRows.map((capability) => capability.name)
  const existingCapabilities = yield* Effect.tryPromise({
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
        message: errorMessage(
          cause,
          `Failed to load existing capabilities for ${connectorId}`,
        ),
      }),
  })

  const staleCapabilityIds = existingCapabilities
    .filter((capability) => !toolNames.includes(capability.name))
    .map((capability) => capability.id)
  yield* deleteStaleCapabilityDependencies(staleCapabilityIds)

  if (staleCapabilityIds.length > 0) {
    yield* Effect.tryPromise({
      try: async () =>
        db
          .delete(schema.capability)
          .where(inArray(schema.capability.id, staleCapabilityIds)),
      catch: (cause) =>
        new CapabilitySyncError({
          code: 'database_failed',
          message: errorMessage(
            cause,
            `Failed to prune stale capabilities for ${connectorId}`,
          ),
        }),
    })
  }

  yield* seedDefaultPermissionGrants({
    capabilities: existingCapabilities
      .filter((capability) => !staleCapabilityIds.includes(capability.id))
      .map((capability) => ({
        id: capability.id,
        riskClass: capability.riskClass,
      })),
    userId,
    workspaceId,
  })
})
