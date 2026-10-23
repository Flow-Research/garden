import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Data, Effect } from 'effect'
import { definePlugin, type ConnectionRef } from '@executor-js/sdk/core'

const DECIDE_MCP_ENDPOINT = new URL('https://api.trydecide.ai/mcp')

export type DirectDecideWhoamiResult = {
  readonly contentBlockCount: number
  readonly textBlockCount: number
}

export class DirectDecideMcpError extends Data.TaggedError(
  'DirectDecideMcpError',
)<{
  readonly stage: 'credential' | 'connect' | 'call'
  readonly message: string
  readonly status?: number
}> {}

const errorRecord = (cause: unknown): Record<string, unknown> | null =>
  cause !== null && typeof cause === 'object' && !Array.isArray(cause)
    ? (cause as Record<string, unknown>)
    : null

/**
 * Keeps the direct MCP comparison useful without returning URLs, OAuth tokens,
 * or provider response bodies. The status is safe and is enough to separate
 * authentication rejection from a connection failure.
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
  return new DirectDecideMcpError({
    stage,
    message:
      status === undefined
        ? `Direct Decide MCP ${stage} failed.`
        : `Direct Decide MCP ${stage} returned HTTP ${status}.`,
    ...(status === undefined ? {} : { status }),
  })
}

/**
 * Calls Decide with the official MCP SDK and a resolved Garden OAuth token.
 * This path exists only to compare the standard SDK with Executor's MCP plugin.
 * It returns result shape metadata and never returns identity text or secrets.
 */
const callDecideWhoami = (accessToken: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const client = new Client({
        name: 'garden-decide-direct-check',
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
        const result = yield* Effect.tryPromise({
          try: () => client.callTool({ name: 'whoami', arguments: {} }),
          catch: (cause) => directFailure('call', cause),
        })
        if (result.isError === true) {
          return yield* new DirectDecideMcpError({
            stage: 'call',
            message: 'Direct Decide MCP whoami returned a tool error.',
          })
        }
        const content = Array.isArray(result.content) ? result.content : []
        return {
          contentBlockCount: content.length,
          textBlockCount: content.filter((block) => block.type === 'text')
            .length,
        } satisfies DirectDecideWhoamiResult
      }),
    ({ client }) => Effect.promise(() => client.close()).pipe(Effect.ignore),
  )

/**
 * Resolves the saved OAuth token inside Executor, then bypasses Executor's MCP
 * plugin for one standard-SDK `whoami` call. The token stays inside the Worker.
 */
export const directDecideMcpPlugin = definePlugin(() => ({
  id: 'directDecideMcp',
  storage: () => ({}),
  extension: (ctx) => ({
    whoami: (connection: ConnectionRef) =>
      Effect.gen(function* () {
        const accessToken = yield* ctx.connections.resolveValue(connection)
        if (accessToken === null || accessToken.length === 0) {
          return yield* new DirectDecideMcpError({
            stage: 'credential',
            message: 'Garden could not resolve the saved Decide OAuth token.',
          })
        }
        return yield* callDecideWhoami(accessToken)
      }),
  }),
}))
