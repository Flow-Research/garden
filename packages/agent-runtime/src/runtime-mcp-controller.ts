import type { MCPServerFilter } from 'agents/mcp/client'
import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai'
import { Effect } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import { getConnectorById } from '@garden/connectors'
import { discordNativeTools } from '@garden/connectors/discord/tools'
import { makeDiscordBaseLayer } from '@garden/connectors/discord/services'
import { isNativeConnector } from '@garden/connectors/sdk'
import {
  buildMcpAiToolKey,
  canonicalJsonString,
  defaultTrustLevelForRisk,
  guardedMcpToolDescription,
} from '@garden/connectors/capabilities'
import * as schema from '@garden/db/schema'
import { upsertPermissionRequestInbox } from '@garden/db/inbox'
import {
  buildConnectorSyncPlan,
  extractThreadIdFromAgentName,
  hasWarmStoredConnectorServers,
  type ActiveConnectorBinding,
  type StoredConnectorServerRow,
} from './mcp-connectors'
import { listAvailableConnectorBindings } from '@garden/server/connectors/availability'
import { mcpRuntimeConfig } from './mcp-runtime-config'

export { canonicalJsonString } from '@garden/connectors/capabilities'

export const MCP_CONNECTOR_SERVER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS mcp_connector_server (
    connector_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    account_id TEXT,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    tools_signature TEXT,
    updated_at TEXT NOT NULL
  )
`

export const PERMISSION_APPROVAL_REUSE_WINDOW_MS = 60 * 1000

export class RuntimeMcpError extends TaggedError('RuntimeMcpError')<{
  code:
    | 'connector_not_found'
    | 'database_failed'
    | 'mcp_connect_failed'
    | 'mcp_discover_failed'
    | 'mcp_readiness_failed'
    | 'mcp_register_failed'
    | 'thread_not_found'
  message: string
}>() {}

export type ThreadRuntimeIdentity = {
  threadId: string
  workspaceId: string
  userId: string
  agentId: string
  issueId?: string
  runId?: string
}

type StoredConnectorServerRowRecord = {
  connector_id: string
  server_id: string
  account_id: string | null
  workspace_id: string
  user_id: string
  agent_id: string
  tools_signature: string | null
}

export type McpHostEnv = {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  HYPERDRIVE: Hyperdrive
  DISCORD_BOT_TOKEN?: string
}

export type McpRegistration =
  | { state: 'failed'; error: string }
  | { state: 'authenticating' }
  | { state: 'connected' }
  | { state: 'ready' }

export type RpcMcpConnectorProps = {
  userId: string
  workspaceId: string
  agentId: string
  issueId?: string
  runId?: string
  connectorId: string
  authKind: 'oauth' | 'api-key' | 'none'
  accountId?: string
}

export type McpToolRecord = {
  name: string
  description?: string | null
  inputSchema?: unknown
  outputSchema?: unknown
  serverId: string
}

type AiJsonSchemaInput = Parameters<typeof jsonSchema>[0]

function asAiJsonSchema(schemaValue: unknown): AiJsonSchemaInput {
  return (schemaValue && typeof schemaValue === 'object'
    ? schemaValue
    : { type: 'object', additionalProperties: true }) as AiJsonSchemaInput
}

export type McpClientFacade = {
  getAITools: (filter?: MCPServerFilter) => ToolSet
  listTools: (filter?: MCPServerFilter) => McpToolRecord[]
  listServers: () => Array<{
    id: string
    name?: string | null
    server_url?: string | null
  }>
  waitForConnections?: (options: { timeout: number }) => Promise<unknown>
  discoverIfConnected: (
    serverId: string,
    options: { timeoutMs: number },
  ) => Promise<{ success: boolean; error?: string } | null | undefined>
}

export type McpHost = {
  readonly name: string
  readonly env: McpHostEnv
  readonly ctx: { storage: { sql: SqlStorage } }
  readonly mcp: McpClientFacade
  readonly getServerStates?: () => RuntimeMcpServerStates
  addRpcMcpServer: (input: {
    connectorId: string
    id: string
    props: RpcMcpConnectorProps
  }) => Promise<McpRegistration & { id?: string }>
  removeMcpServer: (connectorId: string) => Promise<void>
  resolveRuntimeIdentity?: () => Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  >
}

export function isMcpDiscoveryCancellation(message: string | undefined) {
  return message === 'Discovery was cancelled'
}

export function isMcpFailedConnectionStateMessage(message: string | undefined) {
  return Boolean(message?.toLowerCase().includes('failed state'))
}

export class RuntimeMcpController {
  private activeNativeConnectorIds = new Set<string>()

  constructor(private readonly host: McpHost) {}

  /**
   * Resolves the MCP-controller Drizzle client through Hyperdrive's pooled
   * connection string. Previously called `drizzle(this.host.env.DATABASE_URL)`
   * from the neon-serverless driver, opening a fresh direct-to-Neon WebSocket
   * pool per call that bypassed Hyperdrive, never closed, and defeated Neon
   * autosuspend. `getPooledDb` memoizes one node-postgres pool per connection
   * string per isolate so Hyperdrive owns origin pooling.
   */
  private getDb() {
    return getPooledDb(this.host.env.HYPERDRIVE.connectionString)
  }

  /**
   * Treats the MCP server id as the connector id. Agents SDK 0.14.5 supports
   * caller-supplied ids, and Garden now registers RPC connectors with stable
   * connector ids. Older SDK-generated ids are intentionally ignored instead of
   * being mapped through server name or rpc URL compatibility fallbacks.
   */
  private connectorIdForServerId(serverId: string) {
    return getConnectorById(serverId) ? serverId : null
  }

  private serverForConnectorId(connectorId: string) {
    return this.host.mcp
      .listServers()
      .find((server) => server.id === connectorId)
  }

  ensureConnectorServerTable() {
    this.host.ctx.storage.sql.exec(MCP_CONNECTOR_SERVER_SCHEMA_SQL)
  }

  getRawMcpToolKeys(filter?: MCPServerFilter) {
    return new Set(
      this.host.mcp
        .listTools(filter)
        .map((tool) => buildMcpAiToolKey(tool.serverId, tool.name)),
    )
  }

  activeToolKeysWithoutRawMcp(args: {
    assembledTools: ToolSet
    stableMcpTools: ToolSet
    filter?: MCPServerFilter
  }) {
    const rawMcpToolKeys = this.getRawMcpToolKeys(args.filter)
    return [
      ...new Set([
        ...Object.keys(args.assembledTools).filter(
          (key) => !rawMcpToolKeys.has(key),
        ),
        ...Object.keys(args.stableMcpTools),
      ]),
    ]
  }

  wrapGetAITools(
    rawGetMcpAiTools: (filter?: MCPServerFilter) => ToolSet,
    filter?: MCPServerFilter,
    wrapOptions?: {
      shouldAutoApprove?: (input: {
        connectorId: string
        toolName: string
        riskClass: string
      }) => boolean
    },
  ) {
    const rawTools = rawGetMcpAiTools(filter)
    const wrappedRawToolKeys = new Set<string>()
    const wrappedTools = this.host.mcp
      .listTools(filter)
      .reduce<ToolSet>((acc, tool) => {
        const connectorId = this.connectorIdForServerId(tool.serverId)
        if (!connectorId) {
          return acc
        }

        const rawToolKey = buildMcpAiToolKey(tool.serverId, tool.name)
        const toolKey = buildMcpAiToolKey(connectorId, tool.name)
        const rawTool = rawTools[rawToolKey]
        if (!rawTool) {
          return acc
        }
        wrappedRawToolKeys.add(rawToolKey)

        const baseNeedsApproval = rawTool.needsApproval
        const baseExecute = rawTool.execute
        acc[toolKey] = {
          ...rawTool,
          ...(baseExecute
            ? {
                execute: async (
                  ...args: Parameters<NonNullable<typeof baseExecute>>
                ) => {
                  const result = await Result.tryPromise({
                    try: async () => await baseExecute(...args),
                    catch: (cause) =>
                      cause instanceof Error ? cause : new Error(String(cause)),
                  })

                  if (result.isOk()) return result.value

                  console.warn('[agent-runtime] MCP tool call failed', {
                    connectorId,
                    toolName: tool.name,
                    error: result.error.message,
                  })

                  return {
                    error: true,
                    message: `${connectorId}.${tool.name} failed: ${result.error.message}`,
                  }
                },
              }
            : {}),
          description: guardedMcpToolDescription({
            connectorId,
            toolName: tool.name,
            description:
              typeof rawTool.description === 'string'
                ? rawTool.description
                : tool.description,
          }),
          needsApproval: async (
            input: unknown,
            options: {
              toolCallId: string
              messages: ModelMessage[]
              experimental_context?: unknown
            },
          ) => {
            const baseApproval =
              typeof baseNeedsApproval === 'function'
                ? await baseNeedsApproval(input, options)
                : (baseNeedsApproval ?? false)

            if (baseApproval) {
              return true
            }

            const approvalResult = await this.ensureConnectorToolNeedsApproval({
              connectorId,
              toolName: tool.name,
              toolCallId: options.toolCallId,
              toolArgs: input,
              shouldAutoApprove: wrapOptions?.shouldAutoApprove,
            })
            if (approvalResult.isErr()) {
              throw approvalResult.error
            }

            return approvalResult.value
          },
        }
        return acc
      }, {})

    return {
      ...Object.fromEntries(
        Object.entries(rawTools).filter(
          ([key]) => !wrappedRawToolKeys.has(key),
        ),
      ),
      ...wrappedTools,
      ...this.buildNativeAITools(wrapOptions),
    }
  }

  /**
   * Adapts active provider-native connector tools into AI SDK tools. Native
   * connectors are activated by the same availability pass as MCP connectors,
   * but they execute through Effect services instead of proxy MCP sessions.
   */
  private buildNativeAITools(wrapOptions?: {
    shouldAutoApprove?: (input: {
      connectorId: string
      toolName: string
      riskClass: string
    }) => boolean
  }) {
    if (!this.activeNativeConnectorIds.has('discord')) return {}

    return Object.fromEntries(
      discordNativeTools.map((nativeTool) => {
        const toolKey = buildMcpAiToolKey('discord', nativeTool.name)
        return [
          toolKey,
          tool({
            description: guardedMcpToolDescription({
              connectorId: 'discord',
              toolName: nativeTool.name,
              description: nativeTool.description,
            }),
            inputSchema: jsonSchema(asAiJsonSchema(nativeTool.inputSchema)),
            execute: async (input) => {
              const result = await Result.tryPromise({
                try: async () =>
                  await Effect.runPromise(
                    nativeTool
                      .execute(input)
                      .pipe(
                        Effect.provide(
                          makeDiscordBaseLayer({
                            botToken: this.host.env.DISCORD_BOT_TOKEN ?? '',
                          }),
                        ),
                      ),
                  ),
                catch: (cause) =>
                  cause instanceof Error ? cause : new Error(String(cause)),
              })

              if (result.isOk()) return result.value

              console.warn('[agent-runtime] native connector tool call failed', {
                connectorId: 'discord',
                toolName: nativeTool.name,
                error: result.error.message,
              })

              return {
                error: true,
                message: `discord.${nativeTool.name} failed: ${result.error.message}`,
              }
            },
            needsApproval: async (
              input: unknown,
              options: {
                toolCallId: string
                messages: ModelMessage[]
                experimental_context?: unknown
              },
            ) => {
              const approvalResult = await this.ensureConnectorToolNeedsApproval({
                connectorId: 'discord',
                toolName: nativeTool.name,
                toolCallId: options.toolCallId,
                toolArgs: input,
                shouldAutoApprove: wrapOptions?.shouldAutoApprove,
              })
              if (approvalResult.isErr()) {
                throw approvalResult.error
              }

              return approvalResult.value
            },
          }),
        ]
      }),
    ) satisfies ToolSet
  }

  /**
   * Keeps the chat-side approval preflight aligned with MCP proxy defaults.
   * Before this, old workspaces with missing grant rows were forced into `ask`
   * here even though the proxy and Connections UI derive defaults from risk.
   * That created stale approval cards for read tools and blocked connector
   * writes that had product-default grants backfilled later.
   */
  private async ensureConnectorToolNeedsApproval(args: {
    connectorId: string
    toolName: string
    toolCallId: string
    toolArgs: unknown
    shouldAutoApprove?: (input: {
      connectorId: string
      toolName: string
      riskClass: string
    }) => boolean
  }) {
    const identityResult = await this.resolveRuntimeIdentity()
    if (identityResult.isErr()) return identityResult

    const db = this.getDb()
    const capabilityResult = await Result.tryPromise({
      try: async () =>
        db
          .select({
            id: schema.capability.id,
            riskClass: schema.capability.riskClass,
          })
          .from(schema.capability)
          .where(
            and(
              eq(schema.capability.connectorType, args.connectorId),
              eq(schema.capability.name, args.toolName),
            ),
          )
          .limit(1),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load capability for ${args.connectorId}.${args.toolName}`,
        }),
    })
    if (capabilityResult.isErr()) return capabilityResult

    const capability = capabilityResult.value[0]
    if (!capability) {
      return Result.ok(false)
    }
    if (
      args.shouldAutoApprove?.({
        connectorId: args.connectorId,
        toolName: args.toolName,
        riskClass: capability.riskClass,
      })
    ) {
      return Result.ok(false)
    }

    const toolArgsSignature = canonicalJsonString(args.toolArgs)
    const existingRequestResult = await Result.tryPromise({
      try: async () =>
        db
          .select({
            argsJson: schema.permissionRequest.argsJson,
            status: schema.permissionRequest.status,
          })
          .from(schema.permissionRequest)
          .where(
            and(
              eq(
                schema.permissionRequest.agentId,
                identityResult.value.agentId,
              ),
              eq(schema.permissionRequest.capabilityId, capability.id),
              eq(schema.permissionRequest.toolCallId, args.toolCallId),
            ),
          )
          .orderBy(desc(schema.permissionRequest.requestedAt))
          .limit(10),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load permission request for ${args.toolCallId}`,
        }),
    })
    if (existingRequestResult.isErr()) return existingRequestResult

    const existingRequest = existingRequestResult.value.find(
      (request) => canonicalJsonString(request.argsJson) === toolArgsSignature,
    )
    if (existingRequest?.status === 'pending') {
      return Result.ok(true)
    }

    if (
      existingRequest?.status === 'approved' ||
      existingRequest?.status === 'denied'
    ) {
      return Result.ok(false)
    }

    const grantResult = await Result.tryPromise({
      try: async () =>
        db
          .select({
            trustLevel: schema.permissionGrant.trustLevel,
          })
          .from(schema.permissionGrant)
          .where(
            and(
              eq(schema.permissionGrant.agentId, identityResult.value.agentId),
              eq(schema.permissionGrant.capabilityId, capability.id),
            ),
          )
          .limit(1),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load permission grant for ${args.connectorId}.${args.toolName}`,
        }),
    })
    if (grantResult.isErr()) return grantResult

    const trustLevel =
      grantResult.value[0]?.trustLevel ??
      defaultTrustLevelForRisk(capability.riskClass)
    if (trustLevel !== 'ask') {
      return Result.ok(false)
    }

    const matchingApprovalResult = await Result.tryPromise({
      try: async () =>
        db
          .select({
            argsJson: schema.permissionRequest.argsJson,
            resolvedAt: schema.permissionRequest.resolvedAt,
            status: schema.permissionRequest.status,
          })
          .from(schema.permissionRequest)
          .where(
            and(
              eq(
                schema.permissionRequest.agentId,
                identityResult.value.agentId,
              ),
              eq(schema.permissionRequest.capabilityId, capability.id),
            ),
          )
          .orderBy(desc(schema.permissionRequest.requestedAt))
          .limit(20),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load recent permission approvals for ${args.connectorId}.${args.toolName}`,
        }),
    })
    if (matchingApprovalResult.isErr()) return matchingApprovalResult

    const hasReusableApproval = matchingApprovalResult.value.some((request) => {
      if (request.status !== 'approved' || !request.resolvedAt) {
        return false
      }

      return (
        Date.now() - request.resolvedAt.getTime() <=
          PERMISSION_APPROVAL_REUSE_WINDOW_MS &&
        canonicalJsonString(request.argsJson) === toolArgsSignature
      )
    })
    if (hasReusableApproval) {
      return Result.ok(false)
    }

    const insertResult = await Result.tryPromise({
      try: async () => {
        const requestId = crypto.randomUUID()
        await db.insert(schema.permissionRequest).values({
          id: requestId,
          agentId: identityResult.value.agentId,
          capabilityId: capability.id,
          // Source: docs/research/issue-flow-plan.md, "Approval pause".
          runId: identityResult.value.runId ?? null,
          context: `${args.connectorId}.${args.toolName}`,
          issueId: identityResult.value.issueId ?? null,
          argsJson: args.toolArgs as object,
          toolCallId: args.toolCallId,
          status: 'pending',
        })
        await upsertPermissionRequestInbox({
          db,
          workspaceId: identityResult.value.workspaceId,
          requestId,
        })
      },
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to persist permission request for ${args.toolCallId}`,
        }),
    })
    if (insertResult.isErr()) return insertResult

    return Result.ok(true)
  }

  private readConnectorServerRows() {
    return Result.try({
      try: () => {
        const rows = Array.from(
          this.host.ctx.storage.sql.exec(
            `
              SELECT
                connector_id,
                server_id,
                account_id,
                workspace_id,
                user_id,
                agent_id,
                tools_signature
              FROM mcp_connector_server
            `,
          ),
        ) as StoredConnectorServerRowRecord[]

        return rows.map(
          (row) =>
            ({
              connectorId: row.connector_id,
              serverId: row.server_id,
              accountId: row.account_id,
              toolsSignature: row.tools_signature,
            }) satisfies StoredConnectorServerRow,
        )
      },
      catch: () =>
        new RuntimeMcpError({
          code: 'database_failed',
          message: 'Failed to read MCP connector server rows',
        }),
    })
  }

  private upsertConnectorServerRow(input: {
    identity: ThreadRuntimeIdentity
    connectorId: string
    serverId: string
    accountId: string | null
    toolsSignature: string | null
  }) {
    return Result.try({
      try: () =>
        this.host.ctx.storage.sql.exec(
          `
            INSERT INTO mcp_connector_server (
              connector_id,
              server_id,
              account_id,
              workspace_id,
              user_id,
              agent_id,
              tools_signature,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(connector_id) DO UPDATE SET
              server_id = excluded.server_id,
              account_id = excluded.account_id,
              workspace_id = excluded.workspace_id,
              user_id = excluded.user_id,
              agent_id = excluded.agent_id,
              tools_signature = excluded.tools_signature,
              updated_at = excluded.updated_at
          `,
          input.connectorId,
          input.serverId,
          input.accountId,
          input.identity.workspaceId,
          input.identity.userId,
          input.identity.agentId,
          input.toolsSignature,
          new Date().toISOString(),
        ),
      catch: () =>
        new RuntimeMcpError({
          code: 'database_failed',
          message: `Failed to persist MCP connector row for ${input.connectorId}`,
        }),
    })
  }

  private deleteConnectorServerRow(connectorId: string) {
    return Result.try({
      try: () =>
        this.host.ctx.storage.sql.exec(
          `
            DELETE FROM mcp_connector_server
            WHERE connector_id = ?
          `,
          connectorId,
        ),
      catch: () =>
        new RuntimeMcpError({
          code: 'database_failed',
          message: `Failed to delete MCP connector row for ${connectorId}`,
        }),
    })
  }

  private async resolveThreadRuntimeIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  > {
    const threadId = extractThreadIdFromAgentName(this.host.name)
    if (!threadId) {
      return Result.err(
        new RuntimeMcpError({
          code: 'thread_not_found',
          message: `Unable to resolve chat thread from agent "${this.host.name}"`,
        }),
      )
    }

    const db = this.getDb()
    const threadResult = await Result.tryPromise({
      try: async () =>
        db
          .select({
            workspaceId: schema.chatThread.workspaceId,
            userId: schema.chatThread.ownerUserId,
            agentId: schema.chatThread.agentId,
          })
          .from(schema.chatThread)
          .where(eq(schema.chatThread.id, threadId))
          .limit(1),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load chat thread ${threadId}`,
        }),
    })
    if (threadResult.isErr()) return Result.err(threadResult.error)

    const thread = threadResult.value[0]
    if (!thread) {
      return Result.err(
        new RuntimeMcpError({
          code: 'thread_not_found',
          message: `Chat thread ${threadId} was not found`,
        }),
      )
    }

    return Result.ok({
      threadId,
      workspaceId: thread.workspaceId,
      userId: thread.userId,
      agentId: thread.agentId,
    } satisfies ThreadRuntimeIdentity)
  }

  private async resolveRuntimeIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  > {
    return this.host.resolveRuntimeIdentity
      ? await this.host.resolveRuntimeIdentity()
      : await this.resolveThreadRuntimeIdentity()
  }

  private async listActiveConnectorBindings(identity: ThreadRuntimeIdentity) {
    const result = await Result.tryPromise({
      try: async () =>
        await listAvailableConnectorBindings({
          db: this.getDb(),
          getEnvVar: (name) => {
            const value = (this.host.env as Record<string, unknown>)[name]
            return typeof value === 'string' ? value : undefined
          },
          userId: identity.userId,
          workspaceId: identity.workspaceId,
        }),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : 'Failed to load available connector bindings for chat runtime',
        }),
    })

    return result
  }

  private buildConnectorToolsSignature(connectorId: string) {
    const server = this.serverForConnectorId(connectorId)
    return canonicalJsonString(
      this.host.mcp
        .listTools(server ? { serverId: server.id } : { serverId: connectorId })
        .map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
          outputSchema: tool.outputSchema ?? null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    )
  }

  captureObservedMcpToolChanges() {
    this.ensureConnectorServerTable()
    const storedRowsResult = this.readConnectorServerRows()
    if (storedRowsResult.isErr()) return storedRowsResult

    const connectorIdsToSync: string[] = []
    for (const row of storedRowsResult.value) {
      const nextSignature = this.buildConnectorToolsSignature(row.connectorId)
      if (nextSignature === row.toolsSignature) {
        continue
      }

      const updateResult = Result.try({
        try: () =>
          this.host.ctx.storage.sql.exec(
            `
              UPDATE mcp_connector_server
              SET tools_signature = ?, updated_at = ?
              WHERE connector_id = ?
            `,
            nextSignature,
            new Date().toISOString(),
            row.connectorId,
          ),
        catch: () =>
          new RuntimeMcpError({
            code: 'database_failed',
            message: `Failed to update observed tool signature for ${row.connectorId}`,
          }),
      })
      if (updateResult.isErr()) {
        return updateResult
      }

      connectorIdsToSync.push(row.connectorId)
    }

    if (connectorIdsToSync.length > 0) {
      void this.requestCapabilitySyncForConnectors(connectorIdsToSync)
    }

    return Result.ok(connectorIdsToSync)
  }

  async ensureProxyMcpConnections(options?: {
    allowReplacingRegisteredServers?: boolean
  }) {
    this.ensureConnectorServerTable()

    const identityResult = await this.resolveRuntimeIdentity()
    if (identityResult.isErr()) return identityResult

    const bindingsResult = await this.listActiveConnectorBindings(
      identityResult.value,
    )
    if (bindingsResult.isErr()) return bindingsResult

    const mcpBindings = this.activateNativeConnectorBindings(bindingsResult.value)

    const staleTransportResult = await this.removeNonRpcConnectorServers(
      mcpBindings,
    )
    if (staleTransportResult.isErr()) return staleTransportResult

    const failedServerResult = await this.removeFailedConnectorServers(
      mcpBindings,
    )
    if (failedServerResult.isErr()) return failedServerResult
    const precleanedConnectorIds = new Set([
      ...staleTransportResult.value,
      ...failedServerResult.value,
    ])

    const storedRowsResult = this.readConnectorServerRows()
    if (storedRowsResult.isErr()) return storedRowsResult

    const plan = buildConnectorSyncPlan({
      bindings: mcpBindings,
      registeredServerIds: this.host.mcp
        .listServers()
        .map((server) => server.id),
      storedRows: storedRowsResult.value,
    })

    for (const connectorId of plan.connectorIdsToRemove) {
      const removalResult = await this.removeConnectorServer(connectorId)
      if (removalResult.isErr()) {
        console.warn('[agent-runtime] failed to remove stale MCP connector', {
          connectorId,
          error: removalResult.error,
        })
      }
    }

    const failedRefreshes: Array<{ connectorId: string; error: string }> = []
    for (const binding of plan.bindingsToRefresh) {
      const refreshResult = await this.refreshConnectorServer(
        identityResult.value,
        binding,
        {
          allowReplacingRegisteredServers:
            options?.allowReplacingRegisteredServers ?? true,
          precleaned: precleanedConnectorIds.has(binding.connectorId),
        },
      )
      if (refreshResult.isErr()) {
        failedRefreshes.push({
          connectorId: binding.connectorId,
          error: refreshResult.error.message,
        })
        console.warn('[agent-runtime] MCP connector refresh failed', {
          connectorId: binding.connectorId,
          error: refreshResult.error,
        })
      }
    }

    if (failedRefreshes.length > 0) {
      return Result.err(
        new RuntimeMcpError({
          code: 'mcp_connect_failed',
          message: `Failed to refresh MCP connectors: ${failedRefreshes
            .map((failure) => `${failure.connectorId}: ${failure.error}`)
            .join('; ')}`,
        }),
      )
    }

    return Result.ok(undefined)
  }

  /**
   * Splits native connectors out of the MCP refresh plan while keeping their
   * active ids in memory for the current turn's AI tool assembly.
   */
  private activateNativeConnectorBindings(bindings: ActiveConnectorBinding[]) {
    const mcpBindings: ActiveConnectorBinding[] = []
    const nativeConnectorIds = new Set<string>()

    for (const binding of bindings) {
      const connector = getConnectorById(binding.connectorId)
      if (connector && isNativeConnector(connector)) {
        nativeConnectorIds.add(connector.id)
        continue
      }

      mcpBindings.push(binding)
    }

    this.activeNativeConnectorIds = nativeConnectorIds
    return mcpBindings
  }

  private async removeNonRpcConnectorServers(
    bindings: ActiveConnectorBinding[],
  ) {
    const activeConnectorIds = new Set(
      bindings.map((binding) => binding.connectorId),
    )
    const staleServerIds = this.host.mcp
      .listServers()
      .filter((server) => {
        const connectorId = this.connectorIdForServerId(server.id)
        if (!connectorId || !activeConnectorIds.has(connectorId)) return false
        if (typeof server.server_url !== 'string') return false

        return !server.server_url.startsWith('rpc:')
      })
      .map((server) => server.id)

    for (const serverId of staleServerIds) {
      console.warn('[agent-runtime] removing non-RPC MCP connector server', {
        serverId,
      })
      const removalResult = await this.removeConnectorServer(serverId)
      if (removalResult.isErr()) return removalResult
    }

    return Result.ok(staleServerIds)
  }

  private async removeFailedConnectorServers(
    bindings: ActiveConnectorBinding[],
  ) {
    if (!this.host.getServerStates) return Result.ok([])

    const activeConnectorIds = new Set(
      bindings.map((binding) => binding.connectorId),
    )
    const failedServerIds = Object.entries(this.host.getServerStates()).flatMap(
      ([serverId, server]) => {
        const connectorId = this.connectorIdForServerId(serverId)
        if (!connectorId || !activeConnectorIds.has(connectorId)) return []
        return server.state === 'failed' ? [serverId] : []
      },
    )

    for (const serverId of failedServerIds) {
      console.warn('[agent-runtime] removing failed MCP connector server', {
        serverId,
      })
      const removalResult = await this.removeConnectorServer(serverId)
      if (removalResult.isErr()) return removalResult
    }

    return Result.ok(failedServerIds)
  }

  hasWarmProxyMcpConnections(now = Date.now()) {
    this.ensureConnectorServerTable()

    const storedRowsResult = this.readConnectorServerRows()
    if (storedRowsResult.isErr()) return storedRowsResult

    return Result.ok(
      hasWarmStoredConnectorServers({
        storedRows: storedRowsResult.value,
        registeredServerIds: this.host.mcp
          .listServers()
          .map((server) => server.id),
        now,
      }),
    )
  }

  async resetProxyMcpServers(serverIds?: string[]) {
    this.ensureConnectorServerTable()

    const storedRowsResult = this.readConnectorServerRows()
    if (storedRowsResult.isErr()) return storedRowsResult

    const connectorIdsToReset = [
      ...new Set(
        serverIds ?? storedRowsResult.value.map((row) => row.connectorId),
      ),
    ]

    for (const connectorId of connectorIdsToReset) {
      const removalResult = await this.removeConnectorServer(connectorId)
      if (removalResult.isErr()) {
        return removalResult
      }
    }

    return Result.ok(undefined)
  }

  private async removeConnectorServer(connectorOrServerId: string) {
    const storedRowsResult = this.readConnectorServerRows()
    if (storedRowsResult.isErr()) return storedRowsResult

    const storedRow = storedRowsResult.value.find(
      (row) =>
        row.connectorId === connectorOrServerId ||
        row.serverId === connectorOrServerId,
    )
    const server =
      this.host.mcp
        .listServers()
        .find((candidate) => candidate.id === connectorOrServerId) ??
      (storedRow ? this.serverForConnectorId(storedRow.connectorId) : undefined)
    const serverId = server?.id ?? storedRow?.serverId ?? connectorOrServerId
    const connectorId =
      storedRow?.connectorId ??
      this.connectorIdForServerId(serverId) ??
      connectorOrServerId

    const unregisterResult = await Result.tryPromise({
      try: async () => this.host.removeMcpServer(serverId),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'mcp_register_failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to remove MCP server ${serverId}`,
        }),
    })
    if (unregisterResult.isErr()) return unregisterResult

    return this.deleteConnectorServerRow(connectorId)
  }

  private async refreshConnectorServer(
    identity: ThreadRuntimeIdentity,
    binding: ActiveConnectorBinding,
    options?: {
      allowReplacingRegisteredServers?: boolean
      precleaned?: boolean
    },
  ) {
    const connector = getConnectorById(binding.connectorId)
    if (!connector) {
      return Result.err(
        new RuntimeMcpError({
          code: 'connector_not_found',
          message: `Unknown connector: ${binding.connectorId}`,
        }),
      )
    }

    const registeredServer = this.serverForConnectorId(connector.id)
    const hasRegisteredServer = Boolean(registeredServer)

    const storedRowsResult = this.readConnectorServerRows()
    if (storedRowsResult.isErr()) return storedRowsResult
    const storedRow = storedRowsResult.value.find(
      (row) => row.connectorId === connector.id,
    )
    const hasDiscoveredTools = registeredServer
      ? this.host.mcp.listTools({ serverId: registeredServer.id }).length > 0
      : false

    if (
      hasRegisteredServer &&
      hasDiscoveredTools &&
      storedRow?.accountId === binding.accountId
    ) {
      if (!registeredServer) {
        return Result.err(
          new RuntimeMcpError({
            code: 'mcp_register_failed',
            message: `Failed to resolve registered MCP server for ${connector.id}`,
          }),
        )
      }

      return this.upsertConnectorServerRow({
        identity,
        connectorId: connector.id,
        serverId: registeredServer.id,
        accountId: binding.accountId,
        toolsSignature: this.buildConnectorToolsSignature(connector.id),
      })
    }

    if (hasRegisteredServer && !options?.allowReplacingRegisteredServers) {
      return Result.ok(undefined)
    }

    if (!options?.precleaned) {
      const cleanupResult = await this.removeConnectorServer(connector.id)
      if (cleanupResult.isErr()) return cleanupResult
    }

    let connectResult = await this.connectAndDiscoverConnectorServer({
      identity,
      binding,
      connector,
    })

    if (
      connectResult.isErr() &&
      isMcpFailedConnectionStateMessage(connectResult.error.message)
    ) {
      console.warn(
        '[agent-runtime] resetting failed MCP connector before retry',
        {
          connectorId: connector.id,
          error: connectResult.error.message,
        },
      )

      const cleanupResult = await this.removeConnectorServer(connector.id)
      if (cleanupResult.isErr()) return cleanupResult

      connectResult = await this.connectAndDiscoverConnectorServer({
        identity,
        binding,
        connector,
      })
    }

    if (connectResult.isErr()) {
      await this.removeConnectorServer(connector.id)
      return connectResult
    }

    const persistResult = this.upsertConnectorServerRow({
      identity,
      connectorId: connector.id,
      serverId: connectResult.value,
      accountId: binding.accountId,
      toolsSignature: this.buildConnectorToolsSignature(connector.id),
    })
    if (persistResult.isErr()) return persistResult

    return Result.ok(undefined)
  }

  private async connectAndDiscoverConnectorServer(args: {
    identity: ThreadRuntimeIdentity
    binding: ActiveConnectorBinding
    connector: NonNullable<ReturnType<typeof getConnectorById>>
  }) {
    const { identity, binding, connector } = args

    return await Result.tryPromise({
      try: async () => {
        const registration = await this.host.addRpcMcpServer({
          connectorId: connector.id,
          id: connector.id,
          props: {
            userId: identity.userId,
            workspaceId: identity.workspaceId,
            agentId: identity.agentId,
            ...(identity.issueId ? { issueId: identity.issueId } : {}),
            ...(identity.runId ? { runId: identity.runId } : {}),
            connectorId: connector.id,
            authKind: connector.apiKey
              ? 'api-key'
              : connector.oauth
                ? 'oauth'
                : 'none',
            ...(binding.accountId ? { accountId: binding.accountId } : {}),
          },
        })

        if (registration.state === 'failed') {
          throw new RuntimeMcpError({
            code: 'mcp_connect_failed',
            message: registration.error,
          })
        }

        if (registration.state === 'authenticating') {
          throw new RuntimeMcpError({
            code: 'mcp_connect_failed',
            message: `Unexpected OAuth handshake for RPC connector ${connector.id}`,
          })
        }

        const serverId =
          registration.id ??
          this.serverForConnectorId(connector.id)?.id ??
          connector.id
        if (!serverId) {
          throw new RuntimeMcpError({
            code: 'mcp_register_failed',
            message: `Failed to resolve MCP server id for ${connector.id}`,
          })
        }

        const discoveryResult =
          await this.discoverRegisteredConnectorServer(serverId)
        if (discoveryResult.isErr()) {
          throw new RuntimeMcpError({
            code: 'mcp_discover_failed',
            message: discoveryResult.error,
          })
        }

        return serverId
      },
      catch: (cause) => {
        if (cause instanceof RuntimeMcpError) return cause

        const message =
          cause instanceof Error
            ? cause.message
            : `Failed to attach MCP server ${connector.id}`

        return new RuntimeMcpError({
          code: isMcpFailedConnectionStateMessage(message)
            ? 'mcp_discover_failed'
            : 'mcp_register_failed',
          message,
        })
      },
    })
  }

  private async discoverRegisteredConnectorServer(connectorId: string) {
    const discovery = await this.host.mcp.discoverIfConnected(connectorId, {
      timeoutMs: mcpRuntimeConfig.connectorDiscoveryTimeoutMs,
    })
    if (discovery?.success) return Result.ok(undefined)

    const error =
      discovery?.error || `Failed to discover MCP tools for ${connectorId}`
    if (!isMcpDiscoveryCancellation(error)) {
      return Result.err(error)
    }

    const hasDiscoveredTools =
      this.host.mcp.listTools({ serverId: connectorId }).length > 0
    if (hasDiscoveredTools) return Result.ok(undefined)

    await this.host.mcp.waitForConnections?.({
      timeout: mcpRuntimeConfig.connectorDiscoveryWaitTimeoutMs,
    })

    const hasToolsAfterWait =
      this.host.mcp.listTools({ serverId: connectorId }).length > 0
    if (hasToolsAfterWait) return Result.ok(undefined)

    return Result.err(error)
  }

  private async requestCapabilitySyncForConnectors(connectorIds: string[]) {
    const uniqueConnectorIds = [...new Set(connectorIds)]
    if (uniqueConnectorIds.length === 0) {
      return Result.ok(undefined)
    }

    const identityResult = await this.resolveRuntimeIdentity()
    if (identityResult.isErr()) return identityResult

    const endpoint = new URL(
      '/api/internal/capability-sync',
      this.host.env.BETTER_AUTH_URL,
    ).toString()

    for (const connectorId of uniqueConnectorIds) {
      const syncResult = await Result.tryPromise({
        try: async () => {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-garden-internal-secret': this.host.env.BETTER_AUTH_SECRET,
            },
            body: JSON.stringify({
              connectorId,
              userId: identityResult.value.userId,
              workspaceId: identityResult.value.workspaceId,
            }),
          })

          if (!response.ok) {
            throw new Error(
              `Capability sync failed for ${connectorId} with ${response.status}`,
            )
          }
        },
        catch: (cause) =>
          new RuntimeMcpError({
            code: 'database_failed',
            message:
              cause instanceof Error
                ? cause.message
                : `Failed to request capability sync for ${connectorId}`,
          }),
      })
      if (syncResult.isErr()) {
        return syncResult
      }
    }

    return Result.ok(undefined)
  }
}

export type RuntimeMcpPrepareResult = ResultValue<void, string>

type RuntimeMcpReadinessError = { message: string; serverIds: string[] }
type RuntimeMcpReadinessResult = ResultValue<void, RuntimeMcpReadinessError>

export type RuntimeMcpServerStates = Record<
  string,
  {
    state: string
    error?: string | null
    name?: string | null
    server_url?: string | null
  }
>

type RuntimeMcpConnectionPreparerOptions = {
  getController: () => RuntimeMcpController
  fullSyncIntervalMs: number
  waitForConnections?: (timeoutMs: number) => Promise<unknown>
  getServerStates?: () => RuntimeMcpServerStates
  connectionWaitTimeoutMs?: number
  backgroundRefreshFailedMessage: string
  refreshFailedMessage: string
  continuingWithoutReadyMessage: string
  readinessPolicy?: 'opportunistic' | 'required'
  onSuccessfulRefresh?: (controller: RuntimeMcpController) => void
  onThreadNotFound?: (
    reason: string,
    controller: RuntimeMcpController,
  ) => Promise<void>
}

export class RuntimeMcpConnectionPreparer {
  private lastFullSyncAt = 0
  private refreshInFlight: Promise<RuntimeMcpPrepareResult> | null = null

  constructor(private readonly options: RuntimeMcpConnectionPreparerOptions) {}

  async ensureForTurn(reason: string) {
    const controller = this.options.getController()
    const now = Date.now()
    const warmResult = controller.hasWarmProxyMcpConnections(now)

    if (
      warmResult.isOk() &&
      warmResult.value &&
      now - this.lastFullSyncAt < this.options.fullSyncIntervalMs
    ) {
      if (!this.shouldWaitForReadiness()) return controller

      const readinessResult = await this.waitForConnectionsReady(reason)
      if (readinessResult.isOk()) return controller

      console.warn('[agent-runtime] warm MCP connector state is stale', {
        error: readinessResult.error.message,
        serverIds: readinessResult.error.serverIds,
      })

      const resetResult = await controller.resetProxyMcpServers(
        readinessResult.error.serverIds.length > 0
          ? readinessResult.error.serverIds
          : undefined,
      )
      if (resetResult.isErr()) {
        console.warn(
          '[agent-runtime] failed to reset stale MCP connector servers',
          resetResult.error,
        )
      }
    }

    if (warmResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to inspect warm MCP connector state',
        warmResult.error,
      )
    }

    const readyResult = await this.ensureLoaded(reason)
    if (readyResult.isErr()) {
      console.warn(this.options.continuingWithoutReadyMessage, {
        reason,
        error: readyResult.error,
      })
      if (this.options.readinessPolicy === 'required') {
        throw new RuntimeMcpError({
          code: 'mcp_readiness_failed',
          message: readyResult.error,
        })
      }
    }

    return controller
  }

  ensureLoaded(
    reason: string,
    options?: {
      allowReplacingRegisteredServers?: boolean
      waitForReadiness?: boolean
    },
  ): Promise<RuntimeMcpPrepareResult> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = this.refreshWithRetries(reason, options).then(
      (result) => {
        this.refreshInFlight = null
        return result
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        console.warn(this.options.backgroundRefreshFailedMessage, {
          reason,
          error: message,
        })
        this.refreshInFlight = null
        return Result.err(message)
      },
    )

    return this.refreshInFlight
  }

  private async refreshWithRetries(
    reason: string,
    options?: {
      allowReplacingRegisteredServers?: boolean
      waitForReadiness?: boolean
    },
  ): Promise<RuntimeMcpPrepareResult> {
    const controller = this.options.getController()
    const connectionResult = await controller.ensureProxyMcpConnections(options)
    if (connectionResult.isErr()) {
      if (connectionResult.error.code === 'thread_not_found') {
        await this.options.onThreadNotFound?.(reason, controller)
        return Result.ok(undefined)
      }
      console.warn(this.options.refreshFailedMessage, {
        reason,
        error: connectionResult.error,
      })
      return Result.err(connectionResult.error.message)
    }

    if (options?.waitForReadiness !== false && this.shouldWaitForReadiness()) {
      const readinessResult = await this.waitForConnectionsReady(reason)
      if (readinessResult.isErr()) {
        console.warn('[agent-runtime] MCP connector readiness check failed', {
          reason,
          error: readinessResult.error.message,
          serverIds: readinessResult.error.serverIds,
        })

        const resetResult = await controller.resetProxyMcpServers(
          readinessResult.error.serverIds.length > 0
            ? readinessResult.error.serverIds
            : undefined,
        )
        if (resetResult.isErr()) {
          console.warn(
            '[agent-runtime] failed to reset stale MCP connector servers',
            resetResult.error,
          )
        }
        return Result.err(readinessResult.error.message)
      }
    }

    this.lastFullSyncAt = Date.now()
    this.options.onSuccessfulRefresh?.(controller)
    return Result.ok(undefined)
  }

  private shouldWaitForReadiness() {
    return Boolean(
      this.options.waitForConnections && this.options.getServerStates,
    )
  }

  private async waitForConnectionsReady(
    reason: string,
  ): Promise<RuntimeMcpReadinessResult> {
    if (!this.options.waitForConnections || !this.options.getServerStates) {
      return Result.ok(undefined)
    }

    const waitResult = await Result.tryPromise({
      try: async () =>
        await this.options.waitForConnections!(
          this.options.connectionWaitTimeoutMs ??
            mcpRuntimeConfig.connectionWaitTimeoutMs,
        ),
      catch: (cause) =>
        cause instanceof Error
          ? cause.message
          : 'Failed waiting for MCP connections',
    })
    if (waitResult.isErr()) {
      return Result.err({
        message: waitResult.error,
        serverIds: [],
      })
    }

    const notReadyServers = Object.entries(
      this.options.getServerStates(),
    ).flatMap(([serverId, server]) => {
      if (server.state === 'ready') return []
      return [
        {
          id: serverId,
          state: server.state,
          error: server.error,
        },
      ]
    })

    if (notReadyServers.length === 0) return Result.ok(undefined)

    return Result.err({
      message: `MCP servers are not ready after ${reason}: ${notReadyServers
        .map((server) =>
          server.error
            ? `${server.id}:${server.state} (${server.error})`
            : `${server.id}:${server.state}`,
        )
        .join(', ')}`,
      serverIds: notReadyServers.map((server) => server.id),
    })
  }
}
