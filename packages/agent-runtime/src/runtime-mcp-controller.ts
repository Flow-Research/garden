import type { MCPServerFilter } from 'agents/mcp/client'
import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai'
import { Effect } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq } from 'drizzle-orm'
import { getWorkerPooledDb } from '@garden/db/runtime'
import { getConnectorById } from '@garden/connectors'
import { discordNativeTools } from '@garden/connectors/discord/tools'
import { makeDiscordBaseLayer } from '@garden/connectors/discord/services'
import {
  GitHubHostedMcpClient,
  makeGitHubHostedMcpBaseLayer,
  type GitHubHostedMcpTool,
} from '@garden/connectors/github/mcp-client'
import { makeGitHubBaseLayer } from '@garden/connectors/github/rest-client'
import { githubNativeTools } from '@garden/connectors/github/tools'
import { isNativeConnector } from '@garden/connectors/sdk'
import {
  buildMcpAiToolKey,
  canonicalJsonString,
  defaultTrustLevelForRisk,
  guardedMcpToolDescription,
} from '@garden/connectors/capabilities'
import * as schema from '@garden/db/schema'
import { captureGardenAnalyticsEvent } from '@garden/observability/analytics/client'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { upsertPermissionRequestInbox } from '@garden/db/inbox'
import {
  extractThreadIdFromAgentName,
  type ActiveConnectorBinding,
  type StoredConnectorServerRow,
} from './mcp-connectors'
import { listAvailableConnectorBindings } from '@garden/server/connectors/availability'
import { mcpRuntimeConfig } from './mcp-runtime-config'
import type { ExecutorMcpResource } from './mail-tool-boundary'

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
  DATABASE_URL?: string
  DISCORD_BOT_TOKEN?: string
  GITHUB_APP_ID?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_APP_PRIVATE_KEY?: string
  ENVIRONMENT?: string
  VITE_PUBLIC_POSTHOG_HOST?: string
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
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
  return (
    schemaValue && typeof schemaValue === 'object'
      ? schemaValue
      : { type: 'object', additionalProperties: true }
  ) as AiJsonSchemaInput
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
  readonly ctx: {
    storage: { sql: SqlStorage }
    waitUntil?: (promise: Promise<unknown>) => void
  }
  readonly mcp: McpClientFacade
  readonly getServerStates?: () => RuntimeMcpServerStates
  addRpcMcpServer?: (input: {
    connectorId: string
    id: string
    props: RpcMcpConnectorProps
  }) => Promise<McpRegistration & { id?: string }>
  addExecutorMcpServer?: (input: {
    id: string
    props: {
      session: {
        organizationId: string
        userId: string
        elicitationMode: 'model' | 'browser'
        resource: ExecutorMcpResource
        toolkitConnectionNames?: readonly string[]
        webOrigin?: string
      }
    }
  }) => Promise<McpRegistration & { id?: string }>
  getExecutorMcpResource?: () => ExecutorMcpResource
  getExecutorToolkitConnectionNames?: () => readonly string[]
  removeMcpServer: (connectorId: string) => Promise<void>
  githubHostedMcp?: {
    listTools: (
      installationId: string,
    ) => Promise<readonly GitHubHostedMcpTool[]>
    callTool: (
      installationId: string,
      name: string,
      input: unknown,
    ) => Promise<unknown>
  }
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
  private activeNativeConnectorAccounts = new Map<string, string | null>()
  private activeGitHubHostedMcpTools: readonly GitHubHostedMcpTool[] = []
  private githubHostedCapabilitiesSynced = false

  constructor(private readonly host: McpHost) {}

  /** Uses Hyperdrive in production and the Worker-safe direct adapter locally. */
  private getDb() {
    return getWorkerPooledDb({
      environment: this.host.env.ENVIRONMENT,
      directConnectionString: this.host.env.DATABASE_URL,
      hyperdrive: this.host.env.HYPERDRIVE,
    })
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

  private githubAppConfig(installationId: string) {
    return {
      appId: this.host.env.GITHUB_APP_ID,
      clientId: this.host.env.GITHUB_CLIENT_ID,
      privateKey: this.host.env.GITHUB_APP_PRIVATE_KEY,
      installationId,
    }
  }

  private async refreshGitHubHostedMcpTools() {
    const installationId = this.activeNativeConnectorAccounts.get('github')
    if (!installationId) {
      this.activeGitHubHostedMcpTools = []
      this.githubHostedCapabilitiesSynced = false
      return
    }

    const result = await Result.tryPromise({
      try: async () =>
        this.host.githubHostedMcp
          ? await this.host.githubHostedMcp.listTools(installationId)
          : await Effect.runPromise(
              Effect.gen(function* () {
                const client = yield* GitHubHostedMcpClient
                return yield* client.listTools()
              }).pipe(
                Effect.provide(
                  makeGitHubHostedMcpBaseLayer(
                    this.githubAppConfig(installationId),
                  ),
                ),
              ),
            ),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })
    if (result.isErr()) {
      this.activeGitHubHostedMcpTools = []
      console.warn('[agent-runtime] GitHub hosted MCP discovery failed', {
        error: result.error.message,
      })
      return
    }

    const githubConnector = getConnectorById('github')
    const classifiedToolNames = new Set(
      Object.keys(githubConnector?.tools ?? {}),
    )
    this.activeGitHubHostedMcpTools = result.value.filter((hostedTool) =>
      classifiedToolNames.has(hostedTool.name),
    )
    if (
      this.activeGitHubHostedMcpTools.length > 0 &&
      !this.githubHostedCapabilitiesSynced
    ) {
      const syncResult = await this.requestCapabilitySyncForConnectors([
        'github',
      ])
      if (syncResult.isErr()) {
        this.activeGitHubHostedMcpTools = []
        console.warn(
          '[agent-runtime] GitHub hosted MCP capability sync failed',
          { error: syncResult.error.message },
        )
        return
      }
      this.githubHostedCapabilitiesSynced = true
    }
  }

  private callGitHubHostedMcpTool(
    installationId: string,
    name: string,
    input: unknown,
  ) {
    return Result.tryPromise({
      try: async () =>
        this.host.githubHostedMcp
          ? await this.host.githubHostedMcp.callTool(
              installationId,
              name,
              input,
            )
          : await Effect.runPromise(
              Effect.gen(function* () {
                const client = yield* GitHubHostedMcpClient
                return yield* client.callTool(name, input)
              }).pipe(
                Effect.provide(
                  makeGitHubHostedMcpBaseLayer(
                    this.githubAppConfig(installationId),
                  ),
                ),
              ),
            ),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })
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
    const discordGuildId = this.activeNativeConnectorAccounts.get('discord')
    const discordTools = discordGuildId
      ? Object.fromEntries(
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
                  const outcome = await Effect.runPromise(
                    Effect.match(
                      nativeTool.execute(input).pipe(
                        Effect.provide(
                          makeDiscordBaseLayer({
                            botToken: this.host.env.DISCORD_BOT_TOKEN ?? '',
                            guildId: discordGuildId,
                          }),
                        ),
                      ),
                      {
                        onFailure: (error) => ({
                          kind: 'failure' as const,
                          message: error.message,
                        }),
                        onSuccess: (value) => ({
                          kind: 'success' as const,
                          value,
                        }),
                      },
                    ),
                  )

                  if (outcome.kind === 'success') return outcome.value

                  console.warn(
                    '[agent-runtime] native connector tool call failed',
                    {
                      connectorId: 'discord',
                      toolName: nativeTool.name,
                      error: outcome.message,
                    },
                  )

                  return {
                    error: true,
                    message: `discord.${nativeTool.name} failed: ${outcome.message}`,
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
                  const approvalResult =
                    await this.ensureConnectorToolNeedsApproval({
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
        )
      : {}

    const githubInstallationId =
      this.activeNativeConnectorAccounts.get('github')
    const githubTools = githubInstallationId
      ? Object.fromEntries(
          githubNativeTools.map((nativeTool) => {
            const toolKey = buildMcpAiToolKey('github', nativeTool.name)
            return [
              toolKey,
              tool({
                description: guardedMcpToolDescription({
                  connectorId: 'github',
                  toolName: nativeTool.name,
                  description: nativeTool.description,
                }),
                inputSchema: jsonSchema(asAiJsonSchema(nativeTool.inputSchema)),
                execute: async (input) => {
                  const outcome = await Effect.runPromise(
                    Effect.match(
                      nativeTool.execute(input).pipe(
                        Effect.provide(
                          makeGitHubBaseLayer({
                            appId: this.host.env.GITHUB_APP_ID,
                            clientId: this.host.env.GITHUB_CLIENT_ID,
                            privateKey: this.host.env.GITHUB_APP_PRIVATE_KEY,
                            installationId: githubInstallationId,
                          }),
                        ),
                      ),
                      {
                        onFailure: (error) => ({
                          kind: 'failure' as const,
                          message: error.message,
                        }),
                        onSuccess: (value) => ({
                          kind: 'success' as const,
                          value,
                        }),
                      },
                    ),
                  )

                  if (outcome.kind === 'success') return outcome.value

                  console.warn(
                    '[agent-runtime] native connector tool call failed',
                    {
                      connectorId: 'github',
                      toolName: nativeTool.name,
                      error: outcome.message,
                    },
                  )

                  return {
                    error: true,
                    message: `github.${nativeTool.name} failed: ${outcome.message}`,
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
                  const approvalResult =
                    await this.ensureConnectorToolNeedsApproval({
                      connectorId: 'github',
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
        )
      : {}

    const githubHostedMcpTools = githubInstallationId
      ? Object.fromEntries(
          this.activeGitHubHostedMcpTools.map((hostedTool) => {
            const toolKey = buildMcpAiToolKey('github-mcp', hostedTool.name)
            return [
              toolKey,
              tool({
                description: guardedMcpToolDescription({
                  connectorId: 'github-mcp',
                  toolName: hostedTool.name,
                  description: hostedTool.description,
                }),
                inputSchema: jsonSchema(asAiJsonSchema(hostedTool.inputSchema)),
                execute: async (input) => {
                  const outcome = await this.callGitHubHostedMcpTool(
                    githubInstallationId,
                    hostedTool.name,
                    input,
                  )
                  if (outcome.isOk()) return outcome.value

                  console.warn(
                    '[agent-runtime] GitHub hosted MCP tool call failed',
                    {
                      toolName: hostedTool.name,
                      error: outcome.error.message,
                    },
                  )
                  return {
                    error: true,
                    message: `github-mcp.${hostedTool.name} failed: ${outcome.error.message}`,
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
                  const approvalResult =
                    await this.ensureConnectorToolNeedsApproval({
                      connectorId: 'github',
                      toolName: hostedTool.name,
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
        )
      : {}

    return {
      ...discordTools,
      ...githubTools,
      ...githubHostedMcpTools,
    } satisfies ToolSet
  }

  /**
   * Keeps the chat-side approval preflight aligned with Executor MCP defaults.
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
        return requestId
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

    const analyticsTask = Result.tryPromise({
      try: async () =>
        await captureGardenAnalyticsEvent(this.host.env, {
          distinctId: identityResult.value.userId,
          event: GARDEN_ANALYTICS_EVENTS.approvalRequested,
          workspaceId: identityResult.value.workspaceId,
          properties: {
            approval_id: insertResult.value,
            approval_kind: 'connector_write',
            connector_id: args.connectorId,
            tool_name: args.toolName,
            tool_call_id: args.toolCallId,
            capability_id: capability.id,
            risk_class: capability.riskClass,
            issue_id: identityResult.value.issueId,
            run_id: identityResult.value.runId,
            agent_id: identityResult.value.agentId,
            tool_args: args.toolArgs,
          },
        }),
      catch: (cause) => cause,
    }).then((result) => {
      if (result.isErr()) {
        console.warn('[agent-runtime] failed to capture approval request', {
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
          approvalId: insertResult.value,
        })
      }
    })
    if (this.host.ctx.waitUntil) {
      this.host.ctx.waitUntil(analyticsTask)
    } else {
      void analyticsTask
    }

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
        .sort((firstTool, secondTool) =>
          firstTool.name.localeCompare(secondTool.name),
        ),
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

  async ensureProxyMcpConnections(_options?: {
    allowReplacingRegisteredServers?: boolean
  }) {
    this.ensureConnectorServerTable()

    const identityResult = await this.resolveRuntimeIdentity()
    if (identityResult.isErr()) return identityResult

    const bindingsResult = await this.listActiveConnectorBindings(
      identityResult.value,
    )
    if (bindingsResult.isErr()) return bindingsResult
    const addExecutorMcpServer = this.host.addExecutorMcpServer
    if (!addExecutorMcpServer) {
      return Result.err(
        new RuntimeMcpError({
          code: 'mcp_register_failed',
          message: 'Executor MCP session binding is unavailable',
        }),
      )
    }

    this.activateNativeConnectorBindings(bindingsResult.value)
    await this.refreshGitHubHostedMcpTools()
    const executorServerId = 'executor'
    for (const server of this.host.mcp.listServers()) {
      if (server.id !== executorServerId && getConnectorById(server.id)) {
        await this.host.removeMcpServer(server.id)
      }
    }
    if (
      !this.host.mcp
        .listServers()
        .some((server) => server.id === executorServerId)
    ) {
      const resource = this.host.getExecutorMcpResource?.() ?? {
        kind: 'default' as const,
      }
      const registration = await addExecutorMcpServer({
        id: executorServerId,
        props: {
          session: {
            organizationId: identityResult.value.workspaceId,
            userId: identityResult.value.userId,
            elicitationMode: resource.kind === 'toolkit' ? 'browser' : 'model',
            resource,
            ...(this.host.getExecutorToolkitConnectionNames
              ? {
                  toolkitConnectionNames:
                    this.host.getExecutorToolkitConnectionNames(),
                }
              : {}),
            ...(this.host.env.BETTER_AUTH_URL
              ? { webOrigin: this.host.env.BETTER_AUTH_URL }
              : {}),
          },
        },
      })
      if (registration.state === 'failed') {
        return Result.err(
          new RuntimeMcpError({
            code: 'mcp_connect_failed',
            message: registration.error,
          }),
        )
      }
    }
    return Result.ok(undefined)
  }

  /**
   * Splits native connectors out of the MCP refresh plan while keeping their
   * active ids in memory for the current turn's AI tool assembly.
   */
  private activateNativeConnectorBindings(bindings: ActiveConnectorBinding[]) {
    const mcpBindings: ActiveConnectorBinding[] = []
    const nativeConnectorAccounts = new Map<string, string | null>()

    for (const binding of bindings) {
      const connector = getConnectorById(binding.connectorId)
      if (connector && isNativeConnector(connector)) {
        nativeConnectorAccounts.set(connector.id, binding.accountId)
        continue
      }

      mcpBindings.push(binding)
    }

    this.activeNativeConnectorAccounts = nativeConnectorAccounts
    return mcpBindings
  }

  hasWarmProxyMcpConnections(
    _now = Date.now(),
  ): ResultValue<boolean, RuntimeMcpError> {
    return Result.ok(
      this.host.mcp.listServers().some((server) => server.id === 'executor'),
    )
  }

  async resetProxyMcpServers(_serverIds?: string[]) {
    const executorServer = this.host.mcp
      .listServers()
      .find((server) => server.id === 'executor')
    if (!executorServer) return Result.ok(undefined)

    return Result.tryPromise({
      try: async () => this.host.removeMcpServer(executorServer.id),
      catch: (cause) =>
        new RuntimeMcpError({
          code: 'mcp_register_failed',
          message:
            cause instanceof Error
              ? cause.message
              : 'Failed to reset Executor MCP session',
        }),
    })
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
