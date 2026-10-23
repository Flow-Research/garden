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
 * Calls one Decide tool with the official Streamable HTTP MCP client. Public
 * progress uses the SDK callback. The five-minute boundary applies only to
 * provider work; connection setup still uses the SDK default.
 */
const callDecideTool = (
  accessToken: string,
  request: {
    readonly name: string
    readonly arguments: Record<string, unknown>
  },
  options: DirectDecideCallOptions,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const client = new Client({
        name: 'garden-decide',
        version: '1.0.0',
      })
      const transport = new StreamableHTTPClientTransport(DECIDE_MCP_ENDPOINT, {
        requestInit: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      })
      return { client, transport }
    }),
    ({ client, transport }) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => client.connect(transport),
          catch: (cause) => directFailure('connect', cause),
        })
        return yield* Effect.tryPromise({
          try: () =>
            client.callTool(request, undefined, {
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
              ...(options.onProgress === undefined
                ? {}
                : {
                    onprogress: options.onProgress,
                    resetTimeoutOnProgress: true,
                  }),
              timeout: DECIDE_ANALYSIS_TIMEOUT_MS,
              maxTotalTimeout: DECIDE_ANALYSIS_TIMEOUT_MS,
            }),
          catch: (cause) => directFailure('call', cause),
        })
      }),
    ({ client }) => Effect.promise(() => client.close()).pipe(Effect.ignore),
  )

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
export const directDecideMcpPlugin = definePlugin(() => ({
  id: 'directDecideMcp',
  storage: () => ({}),
  extension: (ctx) => ({
    call: (
      connection: ConnectionRef,
      request: {
        readonly name: string
        readonly arguments: Record<string, unknown>
      },
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
        return yield* callDecideTool(accessToken, request, options)
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
}))

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
