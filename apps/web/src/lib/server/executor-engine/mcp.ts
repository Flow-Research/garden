import { Effect } from 'effect'
import {
  collectTables,
  Subject,
  Tenant,
  createExecutor,
  type BlobStore,
  type Executor,
  type ExecutorDb,
  type ElicitationContext,
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
import {
  gardenMailExecutorConnectionPattern,
  gardenMailExecutorPolicyRules,
  isGardenMailExecutorConnectionName,
  isGardenMailExecutorToolkit,
} from './mail-toolkit'
import {
  makeApprovalInvocationTracker,
  observeApprovalInvocation,
  type ApprovalInvocationTracker,
} from './approval-invocation'

type GardenMailSessionMeta = SessionMeta & {
  readonly toolkitConnectionNames?: readonly string[]
}

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

/**
 * Observes the provider invocation inside Executor, before its result crosses
 * into generated JavaScript. A sandbox program may catch the later dispatcher
 * error, but cannot turn this exact invocation outcome back into success.
 */
const observeApprovalInvocations = (
  executor: GardenExecutor,
  tracker: ApprovalInvocationTracker,
): GardenExecutor => ({
  ...executor,
  execute: (address, args, options) => {
    const handler = options?.onElicitation
    if (typeof handler !== 'function') {
      return executor.execute(address, args, options)
    }
    const contexts = new Set<ElicitationContext>()
    return observeApprovalInvocation(
      executor.execute(address, args, {
        ...options,
        onElicitation: (context) =>
          Effect.sync(() => contexts.add(context)).pipe(
            Effect.andThen(handler(context)),
          ),
      }),
      contexts,
      tracker,
    )
  },
})

interface GardenSessionDb {
  readonly db: ExecutorDb['db']
  readonly blobs: BlobStore
  readonly attachExecutor: (executor: GardenExecutor) => void
  readonly end: () => Promise<void>
}

/**
 * Materializes an isolated toolkit for one hidden Inbox facet. Exact Gmail
 * connections come from Garden's member∩agent mailbox authorization; reads run
 * through Executor and provider mutations require approval. Source consulted:
 * vendored `plugin-toolkits/src/server.ts` and SDK `policies.ts`.
 */
const ensureGardenMailExecutorToolkit = Effect.fn(
  'GardenMailExecutorToolkit.ensure',
)(function* (
  executor: GardenExecutor,
  toolkitSlug: string,
  connectionNames: readonly string[],
) {
  if (
    !isGardenMailExecutorToolkit(toolkitSlug) ||
    connectionNames.length === 0 ||
    connectionNames.some((name) => !isGardenMailExecutorConnectionName(name))
  ) {
    return yield* Effect.fail(new Error('Invalid Garden Mail toolkit scope'))
  }
  const existingToolkits = yield* executor.toolkits.list()
  const toolkit =
    existingToolkits.find((candidate) => candidate.slug === toolkitSlug) ??
    (yield* executor.toolkits.create({
      owner: 'user',
      name: 'Garden Mail',
      slug: toolkitSlug,
    }))

  const connectionPatterns = connectionNames.map(
    gardenMailExecutorConnectionPattern,
  )

  const existingConnections = yield* executor.toolkits.listConnections(
    toolkit.id,
  )
  yield* Effect.forEach(
    existingConnections.filter(
      (connection) => !connectionPatterns.includes(connection.pattern),
    ),
    (connection) =>
      executor.toolkits.removeConnection(toolkit.id, connection.id),
    { discard: true },
  )
  yield* Effect.forEach(
    connectionPatterns.filter(
      (pattern) =>
        !existingConnections.some(
          (connection) => connection.pattern === pattern,
        ),
    ),
    (pattern) => executor.toolkits.createConnection(toolkit.id, { pattern }),
    { discard: true },
  )

  // `createPolicy` prepends, so create the inverse of Executor's canonical
  // first-match resolution order.
  const requiredPolicies = [
    ...gardenMailExecutorPolicyRules(connectionNames),
  ].reverse()
  const existingPolicies = yield* executor.toolkits.listPolicies(toolkit.id)
  const currentOrder = [...existingPolicies]
    .sort((left, right) => left.position.localeCompare(right.position))
    .map(({ pattern, action }) => ({ pattern, action }))
  // Toolkit policy resolution is first-match by ascending fractional position.
  // `createPolicy` prepends by default, so creating the broad block first and
  // exact rules afterwards yields exact rules first and the block last. Rebuild
  // only when that canonical order differs; preserving matching but stale rows
  // can otherwise leave the broad block ahead of every Gmail allow rule.
  const requiredOrder = [...requiredPolicies].reverse()
  const policyOrderMatches =
    currentOrder.length === requiredOrder.length &&
    currentOrder.every(
      (policy, index) =>
        policy.pattern === requiredOrder[index]?.pattern &&
        policy.action === requiredOrder[index]?.action,
    )
  if (!policyOrderMatches) {
    yield* Effect.forEach(
      existingPolicies,
      (existing) => executor.toolkits.removePolicy(toolkit.id, existing.id),
      { discard: true, concurrency: 1 },
    )
    yield* Effect.forEach(
      requiredPolicies,
      (policy) => executor.toolkits.createPolicy(toolkit.id, policy),
      { discard: true, concurrency: 1 },
    )
  }
})

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
  approvalInvocationTracker: ApprovalInvocationTracker,
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

    if (
      session.resource.kind === 'toolkit' &&
      isGardenMailExecutorToolkit(session.resource.slug)
    ) {
      yield* ensureGardenMailExecutorToolkit(
        executor,
        session.resource.slug,
        (session as GardenMailSessionMeta).toolkitConnectionNames ?? [],
      )
    }

    const observedExecutor = observeApprovalInvocations(
      executor,
      approvalInvocationTracker,
    )
    const engine = boundExecutionEngine(
      createExecutionEngine({
        executor: observedExecutor,
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
  private readonly approvalInvocationTracker = makeApprovalInvocationTracker(
    (executionId, outcome) =>
      this.browserApprovalStore.completeOutcome(executionId, outcome),
  )

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
    const toolkitConnectionNames =
      'toolkitConnectionNames' in token &&
      Array.isArray(token.toolkitConnectionNames) &&
      token.toolkitConnectionNames.every((name) => typeof name === 'string')
        ? token.toolkitConnectionNames
        : undefined
    return Effect.succeed({
      organizationId: token.organizationId,
      organizationName: token.organizationId,
      organizationSlug: token.organizationId,
      userId: token.userId,
      elicitationMode: token.elicitationMode,
      artifactsEnabled: false,
      resource: token.resource,
      webOrigin: token.webOrigin,
      ...(toolkitConnectionNames === undefined
        ? {}
        : { toolkitConnectionNames }),
    })
  }

  protected override buildMcpServer(
    session: SessionMeta,
    database: GardenSessionDb,
  ): Effect.Effect<BuiltMcpServer> {
    return buildGardenExecutionStack(
      this.gardenEnv,
      session,
      database,
      this.approvalInvocationTracker,
    ).pipe(
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
          elicitationMode:
            session.elicitationMode === 'browser'
              ? {
                  mode: 'browser' as const,
                  // Garden renders the decision in the trusted mailbox panel.
                  // The real execution/session identifiers stay in the MCP
                  // payload and authenticated server function, never a URL.
                  approvalUrl: () => '#garden-mail-approval',
                }
              : { mode: 'model' as const },
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

  protected override bindApprovalInvocation(
    executionId: string,
    context: ElicitationContext,
  ): Effect.Effect<void> {
    return this.approvalInvocationTracker.bind(executionId, context)
  }

  protected override forgetApprovalInvocation(
    executionId: string,
  ): Effect.Effect<void> {
    return this.approvalInvocationTracker.forget(executionId)
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
