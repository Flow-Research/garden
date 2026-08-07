import { Effect } from 'effect'
import {
  collectTables,
  Subject,
  Tenant,
  createExecutor,
  type BlobStore,
  type Executor,
  type ExecutorDb,
} from '@executor-js/sdk/core'
import { createExecutionEngine } from '@executor-js/execution/core'
import type { ResumeResponse } from '@executor-js/execution/core'
import {
  makeHostedFetch,
  makeHostedHttpClientLayer,
} from '@executor-js/sdk/host-internal'
import {
  PAUSED_APPROVAL_TIMEOUT_MS,
  createExecutorMcpServer,
} from '@executor-js/host-mcp/tool-server'
import {
  McpAgentSessionDOBase,
  type BuiltMcpServer,
  type McpApprovalOwner,
  type McpSessionInit,
  type McpSessionModelResumeResult,
  type SessionMeta,
} from '@executor-js/cloudflare/mcp/agent-durable-object'
import {
  McpExecutionOwnerDirectoryDO,
  mcpExecutionOwnerDirectoryFromNamespace,
  type McpExecutionOwnerDirectory,
  type McpExecutionOwnerRoute,
} from '@executor-js/cloudflare/mcp/execution-owner-directory'
import { mcpSessionStub } from '@executor-js/cloudflare/mcp/session-stub'
import { makeDynamicWorkerExecutor } from '@executor-js/runtime-dynamic-worker'

import { createD1ExecutorDb } from './d1'
import { makeR2BlobStore } from './r2'
import { makeExecutorPlugins, type GardenExecutorPlugins } from './plugins'
import { boundExecutionEngine } from './output-bound'

type ExecutorMcpEnv = Env & {
  readonly BETTER_AUTH_URL?: string
  readonly EXECUTOR_MCP_EXECUTION_OWNER: DurableObjectNamespace
  readonly EXECUTOR_MCP_SESSION: DurableObjectNamespace
  readonly EXECUTOR_SECRET_KEY: string
  readonly EXECUTOR_BLOBS: R2Bucket
  readonly EXECUTOR_DB: D1Database
  readonly LOADER: WorkerLoader
}

type GardenExecutor = Executor<GardenExecutorPlugins>

interface GardenSessionDb {
  readonly db: ExecutorDb['db']
  readonly blobs: BlobStore
  readonly attachExecutor: (executor: GardenExecutor) => void
  readonly end: () => Promise<void>
}

/**
 * Opens one D1 handle for the hibernatable session and makes the SDK handle
 * part of the same disposal boundary. The upstream DO calls `end` on idle
 * disposal and cold restart, so both resources are released together.
 */
const openGardenSessionDb = async (
  env: ExecutorMcpEnv,
): Promise<GardenSessionDb> => {
  const database = await Effect.runPromise(
    createD1ExecutorDb(env.EXECUTOR_DB, collectTables(), env.EXECUTOR_BLOBS),
  )
  const blobs = makeR2BlobStore(env.EXECUTOR_BLOBS)
  let executor: GardenExecutor | null = null
  return {
    db: database.db,
    blobs,
    attachExecutor: (nextExecutor) => {
      executor = nextExecutor
    },
    end: async () => {
      if (executor !== null) {
        await Effect.runPromise(executor.close().pipe(Effect.ignore))
        executor = null
      }
      await database.close()
    },
  }
}

/**
 * Builds the one-Worker Executor stack from published SDK/execution packages.
 * This replaces the private `@executor-js/api/server` host factory with its
 * upstream three-step body: Executor, execution engine, MCP server.
 */
const buildGardenExecutionStack = (
  env: ExecutorMcpEnv,
  session: SessionMeta,
  database: GardenSessionDb,
) =>
  Effect.gen(function* () {
    const hostedHttpOptions = { allowLocalNetwork: false }
    const webBaseUrl = session.webOrigin ?? env.BETTER_AUTH_URL
    const executor = yield* createExecutor({
      tenant: Tenant.make(session.organizationId),
      subject: Subject.make(session.userId),
      db: { db: database.db },
      blobs: database.blobs,
      plugins: makeExecutorPlugins(env.EXECUTOR_SECRET_KEY, {
        activeToolkitSlug:
          session.resource.kind === 'toolkit'
            ? session.resource.slug
            : undefined,
      }),
      httpClientLayer: makeHostedHttpClientLayer(hostedHttpOptions),
      fetch: makeHostedFetch(hostedHttpOptions),
      onElicitation: 'accept-all',
      ...(webBaseUrl === undefined
        ? {}
        : {
            redirectUri: new URL('/api/oauth/callback', webBaseUrl).toString(),
          }),
      oauthCallbackStateOrgSlug: session.organizationSlug,
      coreTools: {
        webBaseUrl,
        orgSlug: session.organizationSlug,
        includeProviders: true,
      },
    })
    database.attachExecutor(executor)

    const engine = boundExecutionEngine(
      createExecutionEngine({
        executor,
        codeExecutor: makeDynamicWorkerExecutor({ loader: env.LOADER }),
      }),
    )
    return { executor, engine }
  })

/**
 * Executor's upstream hibernatable MCP bridge hosted inside Garden's Worker.
 * Identity arrives through Agents SDK DO props; D1/R2 and execution never
 * cross an HTTP/service-binding/JWT boundary.
 */
export class ExecutorMcpSession extends McpAgentSessionDOBase<
  ExecutorMcpEnv,
  GardenSessionDb
> {
  private readonly gardenEnv: ExecutorMcpEnv

  constructor(ctx: DurableObjectState, env: ExecutorMcpEnv) {
    super(ctx, env)
    this.gardenEnv = env
  }

  protected override openSessionDb(): Promise<GardenSessionDb> {
    return openGardenSessionDb(this.gardenEnv)
  }

  protected override resolveSessionMeta(
    token: McpSessionInit,
  ): Effect.Effect<SessionMeta> {
    return Effect.succeed({
      organizationId: token.organizationId,
      organizationName: token.organizationId,
      organizationSlug: token.organizationId,
      userId: token.userId,
      elicitationMode: token.elicitationMode,
      artifactsEnabled: false,
      resource: token.resource,
      webOrigin: token.webOrigin,
    })
  }

  protected override buildMcpServer(
    session: SessionMeta,
    database: GardenSessionDb,
  ): Effect.Effect<BuiltMcpServer> {
    return buildGardenExecutionStack(this.gardenEnv, session, database).pipe(
      Effect.flatMap(({ executor, engine }) =>
        createExecutorMcpServer({
          engine,
          artifacts: executor.artifacts,
          connections: executor.connections,
          artifactsEnabled: false,
          restoredAppsEnabled: false,
          browserApprovalStore: this.browserApprovalStore,
          pausedExecutionHooks: this.pausedExecutionHooks,
          pausedExecutionLeaseMs: PAUSED_APPROVAL_TIMEOUT_MS,
          resumeFallback: this.modelResumeFallback,
          parentSpan: () => this.currentParentSpan(),
          elicitationMode: { mode: 'model' as const },
        }).pipe(Effect.map((mcpServer) => ({ mcpServer, engine }))),
      ),
      Effect.catchCause((cause) =>
        Effect.promise(() => database.end()).pipe(
          Effect.andThen(Effect.failCause(cause)),
        ),
      ),
      Effect.orDie,
    )
  }

  protected override executionOwnerDirectory(): McpExecutionOwnerDirectory | null {
    return mcpExecutionOwnerDirectoryFromNamespace(
      this.gardenEnv.EXECUTOR_MCP_EXECUTION_OWNER,
    )
  }

  protected override forwardModelResumeToOwner(
    owner: McpExecutionOwnerRoute,
    identity: McpApprovalOwner,
    executionId: string,
    response: ResumeResponse,
  ): Effect.Effect<McpSessionModelResumeResult, unknown> {
    return Effect.tryPromise({
      try: () =>
        mcpSessionStub(
          this.gardenEnv.EXECUTOR_MCP_SESSION,
          owner.sessionId,
        ).resumeExecutionForModel(executionId, identity, response),
      catch: (cause) => cause,
    })
  }
}

export class ExecutorMcpExecutionOwnerDirectory extends McpExecutionOwnerDirectoryDO {}
