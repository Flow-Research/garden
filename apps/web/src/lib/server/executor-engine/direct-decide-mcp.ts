import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  CallToolResult,
  Progress,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { Data, Effect } from 'effect'
import {
  definePlugin,
  type ConnectionRef,
  type Executor,
} from '@executor-js/sdk/core'
import { z } from 'zod'
import type { GardenExecutorPlugins } from './plugins'

const DECIDE_MCP_ENDPOINT = new URL('https://api.trydecide.ai/mcp')
const MINUTE_MS = 60_000

/**
 * Decide documents a four-minute default analysis timeout. The direct client
 * allows one extra minute for the MCP response and generated-file metadata.
 */
export const DECIDE_ANALYSIS_TIMEOUT_MS = 5 * MINUTE_MS

export class DirectDecideMcpError extends Data.TaggedError(
  'DirectDecideMcpError',
)<{
  readonly stage: 'credential' | 'connection' | 'connect' | 'call'
  readonly message: string
  readonly status?: number
}> {}

export type DirectDecideCallOptions = {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: Progress) => void
}

type DirectDecideToolRequest = {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

/**
 * Represents one connected Decide MCP session.
 *
 * The official MCP client owns the JSON-RPC request counter and pending
 * response map. Keeping this client for the lifetime of one connection makes
 * request IDs unique across repeated and concurrent calls. Closing the
 * session lets the SDK reject and clear its pending requests.
 */
export type DirectDecideMcpSession = {
  readonly connect: () => Promise<void>
  readonly call: (
    request: DirectDecideToolRequest,
    options: DirectDecideCallOptions,
  ) => Promise<CallToolResult>
  readonly close: () => Promise<void>
}

export type DirectDecideMcpSessionFactory = (input: {
  readonly accessToken: string
  readonly onDisconnect: () => void
}) => DirectDecideMcpSession

const errorRecord = (cause: unknown): Record<string, unknown> | null =>
  cause !== null && typeof cause === 'object' && !Array.isArray(cause)
    ? (cause as Record<string, unknown>)
    : null

/**
 * Preserves safe provider and transport details without returning request
 * data, OAuth tokens, response bodies, or the MCP endpoint URL.
 */
const directFailure = (
  stage: DirectDecideMcpError['stage'],
  cause: unknown,
) => {
  const record = errorRecord(cause)
  const status =
    typeof record?.status === 'number'
      ? record.status
      : typeof record?.statusCode === 'number'
        ? record.statusCode
        : typeof record?.code === 'number' &&
            record.code >= 100 &&
            record.code <= 599
          ? record.code
          : undefined
  const causeMessage =
    typeof record?.message === 'string' && record.message.trim()
      ? record.message
          .trim()
          .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [REDACTED]')
      : null
  return new DirectDecideMcpError({
    stage,
    message:
      causeMessage ??
      (status === undefined
        ? `Direct Decide MCP ${stage} failed.`
        : `Direct Decide MCP ${stage} returned HTTP ${status}.`),
    ...(status === undefined ? {} : { status }),
  })
}

/**
 * Creates the official Decide MCP client and keeps transport shutdown in the
 * same boundary as the client. The disconnect callback lets the session
 * manager discard a client whose SDK response state is no longer usable.
 */
const createDirectDecideMcpSession: DirectDecideMcpSessionFactory = ({
  accessToken,
  onDisconnect,
}) => {
  const client = new Client({
    name: 'garden-decide',
    version: '1.0.0',
  })
  const transport = new StreamableHTTPClientTransport(DECIDE_MCP_ENDPOINT, {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  })
  transport.onclose = onDisconnect

  return {
    connect: () => client.connect(transport),
    call: (request, options) =>
      client
        .callTool(request, CallToolResultSchema, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.onProgress === undefined
            ? {}
            : {
                onprogress: options.onProgress,
                resetTimeoutOnProgress: true,
              }),
          timeout: DECIDE_ANALYSIS_TIMEOUT_MS,
          maxTotalTimeout: DECIDE_ANALYSIS_TIMEOUT_MS,
        })
        // The installed SDK keeps a legacy `toolResult` union in its return
        // type even when CallToolResultSchema validates the response.
        .then((result) => result as CallToolResult),
    close: () =>
      transport
        .terminateSession()
        .catch(() => undefined)
        .then(() => client.close()),
  }
}

type DirectDecideMcpSessionEntry = {
  readonly accessToken: string
  readonly session: DirectDecideMcpSession
  readonly ready: Promise<DirectDecideMcpSession>
  closePromise?: Promise<void>
}

/**
 * Owns direct Decide MCP sessions for one Executor instance.
 *
 * The previous implementation created a new MCP client for every tool call.
 * Each client restarted JSON-RPC request IDs at zero, while the remote
 * session could still have pending requests from the previous call. This
 * manager reuses a client per connection, removes it on every failed call or
 * disconnect, and creates a fresh client after cleanup.
 */
export class DirectDecideMcpSessionManager {
  private readonly sessions = new Map<string, DirectDecideMcpSessionEntry>()

  constructor(
    private readonly createSession: DirectDecideMcpSessionFactory = createDirectDecideMcpSession,
  ) {}

  /**
   * Calls Decide through the connection's current MCP session. A rejected
   * call invalidates that session because its pending RPC state may be stale.
   */
  async call(
    connectionKey: string,
    accessToken: string,
    request: DirectDecideToolRequest,
    options: DirectDecideCallOptions,
  ): Promise<CallToolResult> {
    const entry = this.getOrCreate(connectionKey, accessToken)
    const session = await entry.ready.catch((cause: unknown) => {
      this.evict(connectionKey, entry)
      return Promise.reject(directFailure('connect', cause))
    })
    return session.call(request, options).catch((cause: unknown) => {
      this.evict(connectionKey, entry)
      return Promise.reject(cause)
    })
  }

  /** Closes every session owned by this Executor plugin instance. */
  async close(): Promise<void> {
    const entries = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(entries.map((entry) => this.closeEntry(entry)))
  }

  private getOrCreate(
    connectionKey: string,
    accessToken: string,
  ): DirectDecideMcpSessionEntry {
    const existing = this.sessions.get(connectionKey)
    if (existing?.accessToken === accessToken) return existing
    if (existing !== undefined) this.evict(connectionKey, existing)

    const entryRef: { entry?: DirectDecideMcpSessionEntry } = {}
    const session = this.createSession({
      accessToken,
      onDisconnect: () => {
        if (entryRef.entry !== undefined) {
          this.evict(connectionKey, entryRef.entry)
        }
      },
    })
    const ready = session.connect().then(
      () => session,
      (cause: unknown) =>
        session
          .close()
          .catch(() => undefined)
          .then(() => Promise.reject(cause)),
    )
    const entry = { accessToken, session, ready }
    entryRef.entry = entry
    this.sessions.set(connectionKey, entry)
    return entry
  }

  private evict(
    connectionKey: string,
    entry: DirectDecideMcpSessionEntry,
  ): void {
    if (this.sessions.get(connectionKey) !== entry) return
    this.sessions.delete(connectionKey)
    void this.closeEntry(entry)
  }

  private closeEntry(entry: DirectDecideMcpSessionEntry): Promise<void> {
    if (entry.closePromise !== undefined) return entry.closePromise
    entry.closePromise = entry.ready
      .then((session) => session.close())
      .catch(() => undefined)
    return entry.closePromise
  }
}

const connectionKey = (connection: ConnectionRef) =>
  [connection.integration, connection.owner, connection.name]
    .map(String)
    .join(':')

/**
 * Calls one Decide tool through the session manager. Public progress uses the
 * SDK callback. The five-minute boundary applies only to provider work;
 * connection setup still uses the SDK default.
 */
const callDecideTool = (
  sessions: DirectDecideMcpSessionManager,
  connection: ConnectionRef,
  accessToken: string,
  request: DirectDecideToolRequest,
  options: DirectDecideCallOptions,
) =>
  Effect.tryPromise({
    try: () =>
      sessions.call(connectionKey(connection), accessToken, request, options),
    catch: (cause) =>
      directFailure(
        errorRecord(cause)?.stage === 'connect' ? 'connect' : 'call',
        cause,
      ),
  })

/** Resolves Garden's saved Decide OAuth connection for the current user. */
const resolveDecideConnection = (executor: Executor<GardenExecutorPlugins>) =>
  executor.connections.list().pipe(
    Effect.flatMap((connections) => {
      const connection = connections.find(
        (candidate) => String(candidate.integration) === 'decide',
      )
      return connection === undefined
        ? Effect.fail(
            new DirectDecideMcpError({
              stage: 'connection',
              message: 'No Decide connection is available for this account.',
            }),
          )
        : Effect.succeed({
            owner: connection.owner,
            name: connection.name,
            integration: connection.integration,
          } satisfies ConnectionRef)
    }),
  )

/**
 * Resolves the saved OAuth token inside Executor, then calls Decide without
 * using Executor's MCP transport. The OAuth token stays inside the Worker.
 */
export const directDecideMcpPlugin = definePlugin(() => {
  const sessions = new DirectDecideMcpSessionManager()

  return {
    id: 'directDecideMcp',
    storage: () => ({}),
    extension: (ctx) => ({
      call: (
        connection: ConnectionRef,
        request: DirectDecideToolRequest,
        options: DirectDecideCallOptions = {},
      ) =>
        Effect.gen(function* () {
          const accessToken = yield* ctx.connections.resolveValue(connection)
          if (accessToken === null || accessToken.length === 0) {
            return yield* new DirectDecideMcpError({
              stage: 'credential',
              message: 'Garden could not resolve the saved Decide OAuth token.',
            })
          }
          return yield* callDecideTool(
            sessions,
            connection,
            accessToken,
            request,
            options,
          )
        }),
      whoami: (connection: ConnectionRef) =>
        Effect.gen(function* () {
          const accessToken = yield* ctx.connections.resolveValue(connection)
          if (accessToken === null || accessToken.length === 0) {
            return yield* new DirectDecideMcpError({
              stage: 'credential',
              message: 'Garden could not resolve the saved Decide OAuth token.',
            })
          }
          const result = yield* callDecideTool(
            sessions,
            connection,
            accessToken,
            { name: 'whoami', arguments: {} },
            {},
          )
          const content = Array.isArray(result.content) ? result.content : []
          return {
            contentBlockCount: content.length,
            textBlockCount: content.filter((block) => block.type === 'text')
              .length,
          }
        }),
    }),
    close: () => Effect.promise(() => sessions.close()),
  }
})

const analyzeInput = {
  question: z.string().min(1),
  data: z.string().optional(),
  context: z.string().optional(),
  session_id: z.string().optional(),
}

const sessionInput = { session_id: z.string().min(1) }
const generatedFileInput = {
  session_id: z.string().min(1),
  filename: z.string().min(1),
}

type DirectToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

/** Forwards Decide's customer-safe progress through Garden's MCP request. */
const progressForwarder = (extra: DirectToolExtra) => {
  const progressToken = extra._meta?.progressToken
  if (progressToken === undefined) return undefined
  return (progress: Progress) => {
    void extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken, ...progress },
      })
      .catch(() => undefined)
  }
}

/**
 * Invokes one direct Decide tool and preserves ordered content blocks,
 * structured session data, and generated-file URLs.
 */
const invokeDirectDecide = (
  executor: Executor<GardenExecutorPlugins>,
  name: string,
  args: Record<string, unknown>,
  extra: DirectToolExtra,
): Promise<CallToolResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const connection = yield* resolveDecideConnection(executor)
      return yield* executor.directDecideMcp.call(
        connection,
        { name, arguments: args },
        {
          signal: extra.signal,
          onProgress: progressForwarder(extra),
        },
      )
    }),
  ) as Promise<CallToolResult>

/**
 * Adds the tools from Decide's MCP guide to Garden's Executor MCP server.
 * These tools bypass Executor's failing nested MCP transport.
 */
export const registerDirectDecideTools = (
  server: McpServer,
  executor: Executor<GardenExecutorPlugins>,
) => {
  server.registerTool(
    'decide_analyze',
    {
      title: 'Run analysis with Decide',
      description:
        'Analyze complete raw CSV, TSV, JSON, or text data with Decide. Reuse session_id for follow-up analysis and omit data.',
      inputSchema: analyzeInput,
      annotations: { readOnlyHint: true },
    },
    (args, extra) => invokeDirectDecide(executor, 'analyze', args, extra),
  )
  server.registerTool(
    'decide_list_generated_files',
    {
      title: 'List Decide generated files',
      description: 'List files generated by a completed Decide analysis.',
      inputSchema: sessionInput,
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      invokeDirectDecide(executor, 'list_generated_files', args, extra),
  )
  server.registerTool(
    'decide_read_generated_file',
    {
      title: 'Read a Decide generated file',
      description:
        'Read a generated text file or get the download URL for a binary file.',
      inputSchema: generatedFileInput,
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      invokeDirectDecide(executor, 'read_generated_file', args, extra),
  )
  server.registerTool(
    'decide_whoami',
    {
      title: 'Check Decide connection',
      description: 'Confirm the connected Decide account and permissions.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) => invokeDirectDecide(executor, 'whoami', {}, extra),
  )
}
