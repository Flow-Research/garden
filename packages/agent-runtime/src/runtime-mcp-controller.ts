import type { MCPServerFilter } from "agents/mcp/client";
import type { ModelMessage, ToolSet } from "ai";
import { Result, TaggedError, type Result as ResultValue } from "better-result";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { connectorRegistry, getConnectorById } from "@garden/connectors";
import {
  buildMcpAiToolKey,
  canonicalJsonString,
  guardedMcpToolDescription,
} from "@garden/connectors/capabilities";
import * as schema from "@garden/db/schema";
import { upsertPermissionRequestInbox } from "@garden/db/inbox";
import {
  buildConnectorSyncPlan,
  extractThreadIdFromAgentName,
  hasWarmStoredConnectorServers,
  type ActiveConnectorBinding,
  type StoredConnectorServerRow,
} from "./mcp-connectors";
import { mcpRuntimeConfig } from "./mcp-runtime-config";

export { canonicalJsonString } from "@garden/connectors/capabilities";

export const MCP_CONNECTOR_SERVER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS mcp_connector_server (
    connector_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    account_id TEXT,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    jwt_expires_at TEXT NOT NULL,
    tools_signature TEXT,
    updated_at TEXT NOT NULL
  )
`;

export const PERMISSION_APPROVAL_REUSE_WINDOW_MS = 60 * 1000;

export class RuntimeMcpError extends TaggedError("RuntimeMcpError")<{
  code:
    | "connector_not_found"
    | "database_failed"
    | "jwt_mint_failed"
    | "mcp_connect_failed"
    | "mcp_discover_failed"
    | "mcp_register_failed"
    | "thread_not_found";
  message: string;
}>() {}

export type ThreadRuntimeIdentity = {
  threadId: string;
  workspaceId: string;
  userId: string;
  agentId: string;
  issueId?: string;
  runId?: string;
};

type StoredConnectorServerRowRecord = {
  connector_id: string;
  server_id: string;
  account_id: string | null;
  workspace_id: string;
  user_id: string;
  agent_id: string;
  jwt_expires_at: string;
  tools_signature: string | null;
};

export type McpHostEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_URL: string;
  MCP_PROXY_URL?: string;
};

export type McpRegistration =
  | { state: "failed"; error: string }
  | { state: "authenticating" }
  | { state: "connected" }
  | { state: "ready" };

export type McpToolRecord = {
  name: string;
  description?: string | null;
  inputSchema?: unknown;
  outputSchema?: unknown;
  serverId: string;
};

export type McpClientFacade = {
  getAITools: (filter?: MCPServerFilter) => ToolSet;
  listTools: (filter?: MCPServerFilter) => McpToolRecord[];
  listServers: () => Array<{ id: string }>;
  waitForConnections?: (options: { timeout: number }) => Promise<unknown>;
  registerServer: (
    serverId: string,
    config: {
      url: string;
      name: string;
      transport: {
        type: "streamable-http" | "sse";
        requestInit: { headers: Record<string, string> };
      };
    },
  ) => Promise<unknown>;
  connectToServer: (serverId: string) => Promise<McpRegistration>;
  discoverIfConnected: (
    serverId: string,
    options: { timeoutMs: number },
  ) => Promise<{ success: boolean; error?: string } | null | undefined>;
};

export type McpHost = {
  readonly name: string;
  readonly env: McpHostEnv;
  readonly ctx: { storage: { sql: SqlStorage } };
  readonly mcp: McpClientFacade;
  connectRpcMcpServer?: (input: {
    connectorId: string;
    props: {
      userId: string;
      workspaceId: string;
      agentId: string;
      issueId?: string;
      runId?: string;
      connectorId: string;
      authKind: "oauth" | "api-key" | "none";
      accountId?: string;
    };
  }) => Promise<McpRegistration>;
  removeMcpServer: (connectorId: string) => Promise<void>;
  resolveRuntimeIdentity?: () => Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  >;
};

export function resolveProxyBaseUrl(env: McpHostEnv) {
  const explicitProxyUrl = env.MCP_PROXY_URL?.trim();
  if (explicitProxyUrl) return explicitProxyUrl;

  return new URL("/api/mcp-proxy/", env.BETTER_AUTH_URL).toString();
}

export function buildConnectorProxyMcpUrl(
  connectorId: string,
  proxyBaseUrl: string,
) {
  return new URL(`${connectorId}/mcp`, proxyBaseUrl).toString();
}

export function isMcpDiscoveryCancellation(message: string | undefined) {
  return message === "Discovery was cancelled";
}

export class RuntimeMcpController {
  constructor(private readonly host: McpHost) {}

  private getDb() {
    return drizzle(this.host.env.DATABASE_URL, { schema });
  }

  ensureConnectorServerTable() {
    this.host.ctx.storage.sql.exec(MCP_CONNECTOR_SERVER_SCHEMA_SQL);
  }

  wrapGetAITools(
    rawGetMcpAiTools: (filter?: MCPServerFilter) => ToolSet,
    filter?: MCPServerFilter,
    wrapOptions?: {
      shouldAutoApprove?: (input: {
        connectorId: string;
        toolName: string;
        riskClass: string;
      }) => boolean;
    },
  ) {
    const rawTools = rawGetMcpAiTools(filter);
    const wrappedTools = this.host.mcp
      .listTools(filter)
      .reduce<ToolSet>((acc, tool) => {
        const toolKey = buildMcpAiToolKey(tool.serverId, tool.name);
        const rawTool = rawTools[toolKey];
        if (!rawTool) {
          return acc;
        }

        const baseNeedsApproval = rawTool.needsApproval;
        acc[toolKey] = {
          ...rawTool,
          description: guardedMcpToolDescription({
            connectorId: tool.serverId,
            toolName: tool.name,
            description:
              typeof rawTool.description === "string"
                ? rawTool.description
                : tool.description,
          }),
          needsApproval: async (
            input: unknown,
            options: {
              toolCallId: string;
              messages: ModelMessage[];
              experimental_context?: unknown;
            },
          ) => {
            const baseApproval =
              typeof baseNeedsApproval === "function"
                ? await baseNeedsApproval(input, options)
                : (baseNeedsApproval ?? false);

            if (baseApproval) {
              return true;
            }

            const approvalResult = await this.ensureMcpToolNeedsApproval({
              connectorId: tool.serverId,
              toolName: tool.name,
              toolCallId: options.toolCallId,
              toolArgs: input,
              shouldAutoApprove: wrapOptions?.shouldAutoApprove,
            });
            if (approvalResult.isErr()) {
              throw approvalResult.error;
            }

            return approvalResult.value;
          },
        };
        return acc;
      }, {});

    return {
      ...rawTools,
      ...wrappedTools,
    };
  }

  private async ensureMcpToolNeedsApproval(args: {
    connectorId: string;
    toolName: string;
    toolCallId: string;
    toolArgs: unknown;
    shouldAutoApprove?: (input: {
      connectorId: string;
      toolName: string;
      riskClass: string;
    }) => boolean;
  }) {
    const identityResult = await this.resolveRuntimeIdentity();
    if (identityResult.isErr()) return identityResult;

    const db = this.getDb();
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
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load capability for ${args.connectorId}.${args.toolName}`,
        }),
    });
    if (capabilityResult.isErr()) return capabilityResult;

    const capability = capabilityResult.value[0];
    if (!capability) {
      return Result.ok(false);
    }
    if (
      args.shouldAutoApprove?.({
        connectorId: args.connectorId,
        toolName: args.toolName,
        riskClass: capability.riskClass,
      })
    ) {
      return Result.ok(false);
    }

    const toolArgsSignature = canonicalJsonString(args.toolArgs);
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
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load permission request for ${args.toolCallId}`,
        }),
    });
    if (existingRequestResult.isErr()) return existingRequestResult;

    const existingRequest = existingRequestResult.value.find(
      (request) => canonicalJsonString(request.argsJson) === toolArgsSignature,
    );
    if (existingRequest?.status === "pending") {
      return Result.ok(true);
    }

    if (
      existingRequest?.status === "approved" ||
      existingRequest?.status === "denied"
    ) {
      return Result.ok(false);
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
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load permission grant for ${args.connectorId}.${args.toolName}`,
        }),
    });
    if (grantResult.isErr()) return grantResult;

    if ((grantResult.value[0]?.trustLevel ?? "ask") !== "ask") {
      return Result.ok(false);
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
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load recent permission approvals for ${args.connectorId}.${args.toolName}`,
        }),
    });
    if (matchingApprovalResult.isErr()) return matchingApprovalResult;

    const hasReusableApproval = matchingApprovalResult.value.some((request) => {
      if (request.status !== "approved" || !request.resolvedAt) {
        return false;
      }

      return (
        Date.now() - request.resolvedAt.getTime() <=
          PERMISSION_APPROVAL_REUSE_WINDOW_MS &&
        canonicalJsonString(request.argsJson) === toolArgsSignature
      );
    });
    if (hasReusableApproval) {
      return Result.ok(false);
    }

    const insertResult = await Result.tryPromise({
      try: async () => {
        const requestId = crypto.randomUUID();
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
          status: "pending",
        });
        await upsertPermissionRequestInbox({
          db,
          workspaceId: identityResult.value.workspaceId,
          requestId,
        });
      },
      catch: (cause) =>
        new RuntimeMcpError({
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to persist permission request for ${args.toolCallId}`,
        }),
    });
    if (insertResult.isErr()) return insertResult;

    return Result.ok(true);
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
                jwt_expires_at,
                tools_signature
              FROM mcp_connector_server
            `,
          ),
        ) as StoredConnectorServerRowRecord[];

        return rows.map(
          (row) =>
            ({
              connectorId: row.connector_id,
              serverId: row.server_id,
              accountId: row.account_id,
              jwtExpiresAt: row.jwt_expires_at,
              toolsSignature: row.tools_signature,
            }) satisfies StoredConnectorServerRow,
        );
      },
      catch: () =>
        new RuntimeMcpError({
          code: "database_failed",
          message: "Failed to read MCP connector server rows",
        }),
    });
  }

  private upsertConnectorServerRow(input: {
    identity: ThreadRuntimeIdentity;
    connectorId: string;
    accountId: string | null;
    jwtExpiresAt: string;
    toolsSignature: string | null;
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
              jwt_expires_at,
              tools_signature,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(connector_id) DO UPDATE SET
              server_id = excluded.server_id,
              account_id = excluded.account_id,
              workspace_id = excluded.workspace_id,
              user_id = excluded.user_id,
              agent_id = excluded.agent_id,
              jwt_expires_at = excluded.jwt_expires_at,
              tools_signature = excluded.tools_signature,
              updated_at = excluded.updated_at
          `,
          input.connectorId,
          input.connectorId,
          input.accountId,
          input.identity.workspaceId,
          input.identity.userId,
          input.identity.agentId,
          input.jwtExpiresAt,
          input.toolsSignature,
          new Date().toISOString(),
        ),
      catch: () =>
        new RuntimeMcpError({
          code: "database_failed",
          message: `Failed to persist MCP connector row for ${input.connectorId}`,
        }),
    });
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
          code: "database_failed",
          message: `Failed to delete MCP connector row for ${connectorId}`,
        }),
    });
  }

  private async resolveThreadRuntimeIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  > {
    const threadId = extractThreadIdFromAgentName(this.host.name);
    if (!threadId) {
      return Result.err(
        new RuntimeMcpError({
          code: "thread_not_found",
          message: `Unable to resolve chat thread from agent "${this.host.name}"`,
        }),
      );
    }

    const db = this.getDb();
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
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to load chat thread ${threadId}`,
        }),
    });
    if (threadResult.isErr()) return Result.err(threadResult.error);

    const thread = threadResult.value[0];
    if (!thread) {
      return Result.err(
        new RuntimeMcpError({
          code: "thread_not_found",
          message: `Chat thread ${threadId} was not found`,
        }),
      );
    }

    return Result.ok({
      threadId,
      workspaceId: thread.workspaceId,
      userId: thread.userId,
      agentId: thread.agentId,
    } satisfies ThreadRuntimeIdentity);
  }

  private async resolveRuntimeIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  > {
    return this.host.resolveRuntimeIdentity
      ? await this.host.resolveRuntimeIdentity()
      : await this.resolveThreadRuntimeIdentity();
  }

  private async listActiveConnectorBindings(identity: ThreadRuntimeIdentity) {
    const db = this.getDb();
    const oauthBindingsResult = await Result.tryPromise({
      try: async () =>
        db
          .select({
            accountId: schema.account.id,
            connectorId: schema.account.connectorType,
          })
          .from(schema.account)
          .where(
            and(
              eq(schema.account.workspaceId, identity.workspaceId),
              eq(schema.account.userId, identity.userId),
              eq(schema.account.status, "connected"),
            ),
          ),
      catch: (cause) =>
        new RuntimeMcpError({
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : "Failed to load connector accounts for chat runtime",
        }),
    });
    if (oauthBindingsResult.isErr()) return oauthBindingsResult;

    const githubInstallationsResult = await Result.tryPromise({
      try: async () =>
        db
          .select({ id: schema.githubAppInstallation.id })
          .from(schema.githubAppInstallation)
          .where(
            and(
              eq(
                schema.githubAppInstallation.workspaceId,
                identity.workspaceId,
              ),
              eq(schema.githubAppInstallation.status, "connected"),
            ),
          )
          .limit(1),
      catch: (cause) =>
        new RuntimeMcpError({
          code: "database_failed",
          message:
            cause instanceof Error
              ? cause.message
              : "Failed to load GitHub App installation for chat runtime",
        }),
    });
    if (githubInstallationsResult.isErr()) return githubInstallationsResult;

    const oauthBindings = oauthBindingsResult.value.flatMap((row) => {
      const connectorId = row.connectorId?.trim();
      const connector = connectorId ? getConnectorById(connectorId) : undefined;
      if (!connectorId || !connector?.oauth) {
        return [];
      }

      return [
        {
          connectorId,
          accountId: row.accountId,
        } satisfies ActiveConnectorBinding,
      ];
    });

    const githubBindings =
      githubInstallationsResult.value.length > 0
        ? [
            {
              connectorId: "github",
              accountId: null,
            } satisfies ActiveConnectorBinding,
          ]
        : [];

    const runtimeEnv = this.host.env as Record<string, string | undefined>;
    const nonOAuthBindings = connectorRegistry.flatMap((connector) => {
      if (!connector.oauth && !connector.apiKey) {
        return [
          {
            connectorId: connector.id,
            accountId: null,
          } satisfies ActiveConnectorBinding,
        ];
      }

      const apiKey = connector.apiKey
        ? runtimeEnv[connector.apiKey.envVar]?.trim()
        : undefined;

      return connector.apiKey && apiKey
        ? [
            {
              connectorId: connector.id,
              accountId: null,
            } satisfies ActiveConnectorBinding,
          ]
        : [];
    });

    return Result.ok([
      ...oauthBindings,
      ...githubBindings,
      ...nonOAuthBindings,
    ]);
  }

  private buildConnectorToolsSignature(connectorId: string) {
    return canonicalJsonString(
      this.host.mcp
        .listTools({ serverId: connectorId })
        .map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
          outputSchema: tool.outputSchema ?? null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  captureObservedMcpToolChanges() {
    this.ensureConnectorServerTable();
    const storedRowsResult = this.readConnectorServerRows();
    if (storedRowsResult.isErr()) return storedRowsResult;

    const connectorIdsToSync: string[] = [];
    for (const row of storedRowsResult.value) {
      const nextSignature = this.buildConnectorToolsSignature(row.connectorId);
      if (nextSignature === row.toolsSignature) {
        continue;
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
            code: "database_failed",
            message: `Failed to update observed tool signature for ${row.connectorId}`,
          }),
      });
      if (updateResult.isErr()) {
        return updateResult;
      }

      connectorIdsToSync.push(row.connectorId);
    }

    if (connectorIdsToSync.length > 0) {
      void this.requestCapabilitySyncForConnectors(connectorIdsToSync);
    }

    return Result.ok(connectorIdsToSync);
  }

  async ensureProxyMcpConnections(options?: {
    refreshWindowMs?: number;
    allowReplacingRegisteredServers?: boolean;
  }) {
    this.ensureConnectorServerTable();

    const identityResult = await this.resolveRuntimeIdentity();
    if (identityResult.isErr()) return identityResult;

    const bindingsResult = await this.listActiveConnectorBindings(
      identityResult.value,
    );
    if (bindingsResult.isErr()) return bindingsResult;

    const storedRowsResult = this.readConnectorServerRows();
    if (storedRowsResult.isErr()) return storedRowsResult;

    const plan = buildConnectorSyncPlan({
      bindings: bindingsResult.value,
      registeredServerIds: this.host.mcp
        .listServers()
        .map((server) => server.id),
      storedRows: storedRowsResult.value,
      refreshWindowMs: options?.refreshWindowMs,
    });

    for (const connectorId of plan.connectorIdsToRemove) {
      const removalResult = await this.removeConnectorServer(connectorId);
      if (removalResult.isErr()) {
        console.warn("[agent-runtime] failed to remove stale MCP connector", {
          connectorId,
          error: removalResult.error,
        });
      }
    }

    const failedRefreshes: Array<{ connectorId: string; error: string }> = [];
    for (const binding of plan.bindingsToRefresh) {
      const refreshResult = await this.refreshConnectorServer(
        identityResult.value,
        binding,
        {
          allowReplacingRegisteredServers:
            options?.allowReplacingRegisteredServers ?? true,
        },
      );
      if (refreshResult.isErr()) {
        failedRefreshes.push({
          connectorId: binding.connectorId,
          error: refreshResult.error.message,
        });
        console.warn("[agent-runtime] MCP connector refresh failed", {
          connectorId: binding.connectorId,
          error: refreshResult.error,
        });
      }
    }

    if (failedRefreshes.length > 0) {
      console.warn("[agent-runtime] continuing after MCP connector failures", {
        failedRefreshes,
      });
    }

    return Result.ok(undefined);
  }

  hasWarmProxyMcpConnections(now = Date.now()) {
    this.ensureConnectorServerTable();

    const storedRowsResult = this.readConnectorServerRows();
    if (storedRowsResult.isErr()) return storedRowsResult;

    return Result.ok(
      hasWarmStoredConnectorServers({
        storedRows: storedRowsResult.value,
        registeredServerIds: this.host.mcp
          .listServers()
          .map((server) => server.id),
        now,
      }),
    );
  }

  async resetProxyMcpServers(serverIds?: string[]) {
    this.ensureConnectorServerTable();

    const storedRowsResult = this.readConnectorServerRows();
    if (storedRowsResult.isErr()) return storedRowsResult;

    const idsToReset = serverIds ? new Set(serverIds) : null;
    for (const row of storedRowsResult.value) {
      if (idsToReset && !idsToReset.has(row.serverId)) {
        continue;
      }

      const removalResult = await this.removeConnectorServer(row.connectorId);
      if (removalResult.isErr()) {
        return removalResult;
      }
    }

    return Result.ok(undefined);
  }

  private async removeConnectorServer(connectorId: string) {
    const hasRegisteredServer = this.host.mcp
      .listServers()
      .some((server) => server.id === connectorId);

    if (hasRegisteredServer) {
      const unregisterResult = await Result.tryPromise({
        try: async () => this.host.removeMcpServer(connectorId),
        catch: (cause) =>
          new RuntimeMcpError({
            code: "mcp_register_failed",
            message:
              cause instanceof Error
                ? cause.message
                : `Failed to remove MCP server ${connectorId}`,
          }),
      });
      if (unregisterResult.isErr()) return unregisterResult;
    }

    return this.deleteConnectorServerRow(connectorId);
  }

  private async refreshConnectorServer(
    identity: ThreadRuntimeIdentity,
    binding: ActiveConnectorBinding,
    options?: { allowReplacingRegisteredServers?: boolean },
  ) {
    const connector = getConnectorById(binding.connectorId);
    if (!connector) {
      return Result.err(
        new RuntimeMcpError({
          code: "connector_not_found",
          message: `Unknown connector: ${binding.connectorId}`,
        }),
      );
    }

    const hasRegisteredServer = this.host.mcp
      .listServers()
      .some((server) => server.id === connector.id);

    if (hasRegisteredServer && !options?.allowReplacingRegisteredServers) {
      return Result.ok(undefined);
    }

    const cleanupResult = await this.removeConnectorServer(connector.id);
    if (cleanupResult.isErr()) return cleanupResult;

    const connectResult = await Result.tryPromise({
      try: async () => {
        if (!this.host.connectRpcMcpServer) {
          throw new RuntimeMcpError({
            code: "mcp_register_failed",
            message: `Missing RPC MCP binding for connector ${connector.id}`,
          });
        }

        const registration = await this.host.connectRpcMcpServer({
          connectorId: connector.id,
          props: {
            userId: identity.userId,
            workspaceId: identity.workspaceId,
            agentId: identity.agentId,
            ...(identity.issueId ? { issueId: identity.issueId } : {}),
            ...(identity.runId ? { runId: identity.runId } : {}),
            connectorId: connector.id,
            authKind: connector.apiKey
              ? "api-key"
              : connector.oauth
                ? "oauth"
                : "none",
            ...(binding.accountId ? { accountId: binding.accountId } : {}),
          },
        });

        if (registration.state === "failed") {
          throw new RuntimeMcpError({
            code: "mcp_connect_failed",
            message: registration.error,
          });
        }

        if (registration.state === "authenticating") {
          throw new RuntimeMcpError({
            code: "mcp_connect_failed",
            message: `Unexpected OAuth handshake for RPC connector ${connector.id}`,
          });
        }

        const discoveryResult =
          await this.discoverRegisteredConnectorServer(connector.id);
        if (discoveryResult.isErr()) {
          throw new RuntimeMcpError({
            code: "mcp_discover_failed",
            message: discoveryResult.error,
          });
        }
      },
      catch: (cause) =>
        cause instanceof RuntimeMcpError
          ? cause
          : new RuntimeMcpError({
              code: "mcp_register_failed",
              message:
                cause instanceof Error
                  ? cause.message
                  : `Failed to attach MCP server ${connector.id}`,
            }),
    });
    if (connectResult.isErr()) {
      await this.removeConnectorServer(connector.id);
      return connectResult;
    }

    const persistResult = this.upsertConnectorServerRow({
      identity,
      connectorId: connector.id,
      accountId: binding.accountId,
      jwtExpiresAt: new Date(
        Date.now() + mcpRuntimeConfig.proxyJwtTtlSeconds * 1000,
      ).toISOString(),
      toolsSignature: this.buildConnectorToolsSignature(connector.id),
    });
    if (persistResult.isErr()) return persistResult;

    return Result.ok(undefined);
  }

  private async discoverRegisteredConnectorServer(connectorId: string) {
    const cancelledDelaysMs = [250, 750, 1_500];

    for (let attempt = 0; attempt <= cancelledDelaysMs.length; attempt += 1) {
      const discovery = await this.host.mcp.discoverIfConnected(connectorId, {
        timeoutMs: 30_000,
      });
      if (discovery?.success) return Result.ok(undefined);

      const error =
        discovery?.error || `Failed to discover MCP tools for ${connectorId}`;
      if (!isMcpDiscoveryCancellation(error)) {
        return Result.err(error);
      }

      const hasDiscoveredTools =
        this.host.mcp.listTools({ serverId: connectorId }).length > 0;
      if (hasDiscoveredTools) return Result.ok(undefined);

      await this.host.mcp.waitForConnections?.({ timeout: 30_000 });

      const hasToolsAfterWait =
        this.host.mcp.listTools({ serverId: connectorId }).length > 0;
      if (hasToolsAfterWait) return Result.ok(undefined);

      const delayMs = cancelledDelaysMs[attempt];
      if (delayMs === undefined) return Result.err(error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return Result.err(`Failed to discover MCP tools for ${connectorId}`);
  }

  private async requestCapabilitySyncForConnectors(connectorIds: string[]) {
    const uniqueConnectorIds = [...new Set(connectorIds)];
    if (uniqueConnectorIds.length === 0) {
      return Result.ok(undefined);
    }

    const identityResult = await this.resolveRuntimeIdentity();
    if (identityResult.isErr()) return identityResult;

    const endpoint = new URL(
      "/api/internal/capability-sync",
      this.host.env.BETTER_AUTH_URL,
    ).toString();

    for (const connectorId of uniqueConnectorIds) {
      const syncResult = await Result.tryPromise({
        try: async () => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-garden-internal-secret": this.host.env.BETTER_AUTH_SECRET,
            },
            body: JSON.stringify({
              connectorId,
              userId: identityResult.value.userId,
              workspaceId: identityResult.value.workspaceId,
            }),
          });

          if (!response.ok) {
            throw new Error(
              `Capability sync failed for ${connectorId} with ${response.status}`,
            );
          }
        },
        catch: (cause) =>
          new RuntimeMcpError({
            code: "database_failed",
            message:
              cause instanceof Error
                ? cause.message
                : `Failed to request capability sync for ${connectorId}`,
          }),
      });
      if (syncResult.isErr()) {
        return syncResult;
      }
    }

    return Result.ok(undefined);
  }
}

export type RuntimeMcpPrepareResult = ResultValue<void, string>;

type RuntimeMcpReadinessError = { message: string; serverIds: string[] };
type RuntimeMcpReadinessResult = ResultValue<void, RuntimeMcpReadinessError>;

export type RuntimeMcpServerStates = Record<
  string,
  { state: string; error?: string | null }
>;

type RuntimeMcpConnectionPreparerOptions = {
  getController: () => RuntimeMcpController;
  fullSyncIntervalMs: number;
  waitForConnections?: (timeoutMs: number) => Promise<unknown>;
  getServerStates?: () => RuntimeMcpServerStates;
  connectionWaitTimeoutMs?: number;
  backgroundRefreshFailedMessage: string;
  refreshFailedMessage: string;
  continuingWithoutReadyMessage: string;
  onSuccessfulRefresh?: (controller: RuntimeMcpController) => void;
  onThreadNotFound?: (
    reason: string,
    controller: RuntimeMcpController,
  ) => Promise<void>;
};

export class RuntimeMcpConnectionPreparer {
  private lastFullSyncAt = 0;
  private refreshInFlight: Promise<RuntimeMcpPrepareResult> | null = null;

  constructor(private readonly options: RuntimeMcpConnectionPreparerOptions) {}

  async ensureForTurn(reason: string) {
    const controller = this.options.getController();
    const now = Date.now();
    const warmResult = controller.hasWarmProxyMcpConnections(now);

    if (
      warmResult.isOk() &&
      warmResult.value &&
      now - this.lastFullSyncAt < this.options.fullSyncIntervalMs
    ) {
      if (!this.shouldWaitForReadiness()) return controller;

      const readinessResult = await this.waitForConnectionsReady(reason);
      if (readinessResult.isOk()) return controller;

      console.warn("[agent-runtime] warm MCP connector state is stale", {
        error: readinessResult.error.message,
        serverIds: readinessResult.error.serverIds,
      });

      const resetResult = await controller.resetProxyMcpServers(
        readinessResult.error.serverIds.length > 0
          ? readinessResult.error.serverIds
          : undefined,
      );
      if (resetResult.isErr()) {
        console.warn(
          "[agent-runtime] failed to reset stale MCP connector servers",
          resetResult.error,
        );
      }
    }

    if (warmResult.isErr()) {
      console.warn(
        "[agent-runtime] failed to inspect warm MCP connector state",
        warmResult.error,
      );
    }

    const readyResult = await this.ensureLoaded(reason);
    if (readyResult.isErr()) {
      console.warn(this.options.continuingWithoutReadyMessage, {
        reason,
        error: readyResult.error,
      });
    }

    return controller;
  }

  ensureLoaded(
    reason: string,
    options?: {
      refreshWindowMs?: number;
      allowReplacingRegisteredServers?: boolean;
      waitForReadiness?: boolean;
    },
  ): Promise<RuntimeMcpPrepareResult> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.refreshWithRetries(reason, options).then(
      (result) => {
        this.refreshInFlight = null;
        return result;
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.warn(this.options.backgroundRefreshFailedMessage, {
          reason,
          error: message,
        });
        this.refreshInFlight = null;
        return Result.err(message);
      },
    );

    return this.refreshInFlight;
  }

  private async refreshWithRetries(
    reason: string,
    options?: {
      refreshWindowMs?: number;
      allowReplacingRegisteredServers?: boolean;
      waitForReadiness?: boolean;
    },
  ): Promise<RuntimeMcpPrepareResult> {
    const delaysMs = [0, 1_000, 3_000];
    let lastError = "MCP connector refresh failed";

    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
      const delayMs = delaysMs[attempt] ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const controller = this.options.getController();
      const connectionResult =
        await controller.ensureProxyMcpConnections(options);
      if (connectionResult.isOk()) {
        if (
          options?.waitForReadiness !== false &&
          this.shouldWaitForReadiness()
        ) {
          const readinessResult = await this.waitForConnectionsReady(reason);
          if (readinessResult.isErr()) {
            lastError = readinessResult.error.message;
            console.warn(
              "[agent-runtime] MCP connector readiness check failed",
              {
                reason,
                attempt: attempt + 1,
                error: readinessResult.error.message,
                serverIds: readinessResult.error.serverIds,
              },
            );

            const resetResult = await controller.resetProxyMcpServers(
              readinessResult.error.serverIds.length > 0
                ? readinessResult.error.serverIds
                : undefined,
            );
            if (resetResult.isErr()) {
              lastError = resetResult.error.message;
              console.warn(
                "[agent-runtime] failed to reset stale MCP connector servers",
                resetResult.error,
              );
            }
            continue;
          }
        }

        this.lastFullSyncAt = Date.now();
        this.options.onSuccessfulRefresh?.(controller);
        return Result.ok(undefined);
      }

      if (connectionResult.error.code === "thread_not_found") {
        await this.options.onThreadNotFound?.(reason, controller);
        return Result.ok(undefined);
      }

      lastError = connectionResult.error.message;
      console.warn(this.options.refreshFailedMessage, {
        reason,
        attempt: attempt + 1,
        error: connectionResult.error,
      });
    }

    return Result.err(lastError);
  }

  private shouldWaitForReadiness() {
    return Boolean(
      this.options.waitForConnections && this.options.getServerStates,
    );
  }

  private async waitForConnectionsReady(
    reason: string,
  ): Promise<RuntimeMcpReadinessResult> {
    if (!this.options.waitForConnections || !this.options.getServerStates) {
      return Result.ok(undefined);
    }

    const waitResult = await Result.tryPromise({
      try: async () =>
        await this.options.waitForConnections!(
          this.options.connectionWaitTimeoutMs ?? 10_000,
        ),
      catch: (cause) =>
        cause instanceof Error
          ? cause.message
          : "Failed waiting for MCP connections",
    });
    if (waitResult.isErr()) {
      return Result.err({
        message: waitResult.error,
        serverIds: [],
      });
    }

    const notReadyServers = Object.entries(
      this.options.getServerStates(),
    ).flatMap(([serverId, server]) => {
      if (server.state === "ready") return [];
      return [
        {
          id: serverId,
          state: server.state,
          error: server.error,
        },
      ];
    });

    if (notReadyServers.length === 0) return Result.ok(undefined);

    return Result.err({
      message: `MCP servers are not ready after ${reason}: ${notReadyServers
        .map((server) =>
          server.error
            ? `${server.id}:${server.state} (${server.error})`
            : `${server.id}:${server.state}`,
        )
        .join(", ")}`,
      serverIds: notReadyServers.map((server) => server.id),
    });
  }
}
