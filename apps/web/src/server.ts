import handler from '@tanstack/react-start/server-entry'
import { getAgentByName } from 'agents'
import {
  AgentDO,
  AutomationRunSubAgent,
  AutomationTriggerDO,
  ChatSubAgent,
  IssueRunSubAgent,
  RunWorkflow,
} from '@garden/agent-runtime'
import { proxyToSandbox, Sandbox } from '@cloudflare/sandbox'
import { Result } from 'better-result'
import { eq, max } from 'drizzle-orm'
import { createAuth } from '@/lib/auth'
import type { AppEnv } from '@/lib/server/env'
import { bindAppEnv } from '@/lib/server/env'
import {
  isAgentRuntimeName,
  requireAgentAccess,
} from '@/lib/server/agent-do-router'
import { reconcile } from '@/lib/server/issue-run-reconciler'
import { ensureAgentRow } from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { disposeRpcResult } from '@garden/core/platform/rpc'
import {
  createGardenLogger,
  errorFields,
  requestFields,
  responseFields,
  withRequestIdHeader,
  type GardenLogger,
  type GardenLogFields,
} from '@garden/core/observability/logger'
import { createAppRequestContext } from '@/lib/server/context'

export { AgentDO }
export { AutomationRunSubAgent }
export { AutomationTriggerDO }
export { ChatSubAgent }
export { IssueRunSubAgent }
export { RunWorkflow }
export { Sandbox }

type ServerEnv = AppEnv

const AGENT_DO_AUTH_CACHE_TTL_MS = 60_000
const RECONCILE_ON_FETCH_INTERVAL_MS = 5_000
const AGENT_ROUTING_RETRY = { maxAttempts: 3 }
type AgentDoAuthCacheEntry = {
  expiresAt: number
  agentId: string
  workspaceId: string
}
const agentDoAuthCache = new Map<string, AgentDoAuthCacheEntry>()
let lastFetchReconcileAt = 0
const webLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'worker-entry',
})

function scheduleFetchReconcile(env: ServerEnv, ctx?: ExecutionContext) {
  const now = Date.now()
  if (now - lastFetchReconcileAt < RECONCILE_ON_FETCH_INTERVAL_MS) return
  lastFetchReconcileAt = now

  const task = reconcile(env).then((result) => {
    if (result.isErr()) {
      webLogger.error('issue_run.reconcile.failed', {
        message: result.error.message,
      })
    }
  })
  if (ctx) {
    ctx.waitUntil(task)
  }
}

function responseFromCaughtError(args: {
  event: string
  status: number
  fallback: string
  cause: unknown
  logger: GardenLogger
}) {
  const message =
    args.cause instanceof Error ? args.cause.message : args.fallback
  args.logger.error(args.event, {
    message,
    ...errorFields(args.cause),
  })

  return Response.json(
    {
      error: args.fallback,
    },
    {
      status: args.status >= 200 && args.status <= 599 ? args.status : 500,
    },
  )
}

function getAgentRuntimeNameFromRequest(request: Request) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'agents' || parts[1] !== 'agent-d-o') return null

  const agentRuntimeName = decodeURIComponent(parts[2] ?? '')
  if (!agentRuntimeName || !isAgentRuntimeName(agentRuntimeName)) {
    return null
  }

  return agentRuntimeName
}

async function routeAgentDoRequest(request: Request, env: ServerEnv) {
  const agentRuntimeName = getAgentRuntimeNameFromRequest(request)
  if (!agentRuntimeName) return new Response('Not found', { status: 404 })

  const routedRequest = new Request(request)
  routedRequest.headers.set('x-partykit-namespace', 'agent-d-o')

  const agent = await getAgentByName(env.AgentDO, agentRuntimeName, {
    routingRetry: AGENT_ROUTING_RETRY,
  })
  return await agent.fetch(routedRequest)
}

async function handleChatAgentFixtureRequest(request: Request, env: ServerEnv) {
  if (request.method !== 'POST')
    return new Response('Not found', { status: 404 })
  if (
    request.headers.get('x-garden-internal-secret') !== env.BETTER_AUTH_SECRET
  ) {
    return new Response('Unauthorized', { status: 401 })
  }

  const parsed = await request.json().then(
    (value) => ({ ok: true as const, value }),
    (cause: unknown) => ({
      ok: false as const,
      error: cause instanceof Error ? cause.message : 'Invalid JSON',
    }),
  )
  if (!parsed.ok) return new Response(parsed.error, { status: 400 })

  const body = parsed.value as {
    message?: unknown
    mode?: unknown
    target?: unknown
    userId?: unknown
    workspaceId?: unknown
  }
  const target =
    body.target === 'issue-run' ||
    body.target === 'issue-run-work' ||
    body.target === 'automation-run' ||
    body.target === 'automation-schedule'
      ? body.target
      : 'chat'
  const workspaceId =
    typeof body.workspaceId === 'string' ? body.workspaceId : null
  const userId = typeof body.userId === 'string' ? body.userId : null
  if (!workspaceId || !userId) {
    return new Response('workspaceId and userId are required', { status: 400 })
  }

  const db = getDb(env)
  const agent = await ensureAgentRow({ workspaceId, ownerUserId: userId })
  const hostName = agent.hostName
  if (!hostName)
    return new Response('Agent hostName is missing', { status: 400 })

  const stub = await getAgentByName(env.AgentDO, hostName, {
    routingRetry: AGENT_ROUTING_RETRY,
  })
  if (target === 'chat') {
    const threadId = crypto.randomUUID()
    await db.insert(schema.chatThread).values({
      id: threadId,
      workspaceId,
      ownerUserId: userId,
      agentId: agent.id,
      runtimeKind: 'chat',
      runtimeKey: threadId,
      title: '[fixture] live chat agent',
    })
    await disposeRpcResult(await stub.ensureThread(threadId))
    const tools = await disposeRpcResult(await stub.debugThreadTools(threadId))
    const prompt = await disposeRpcResult(
      await stub.debugThreadPrompt(threadId),
    )
    const toolNames = tools.inventory.map((tool) => tool.key)
    const base = {
      ok: true,
      target,
      agentId: agent.id,
      hostName,
      threadId,
      hasGithubRepoSearchTool: toolNames.includes(
        'tool_github_search_repositories',
      ),
      hasGithubRoutingPrompt: prompt.prompt.includes(
        'search_repositories tool',
      ),
      hasActivateSkillTool: toolNames.includes('activate_skill'),
      hasReadSkillResourceTool: toolNames.includes('read_skill_resource'),
      hasSkillsPrompt: prompt.prompt.includes('Available skills'),
    }
    if (body.mode === 'inspect') return Response.json({ ...base, toolNames })
    const message = typeof body.message === 'string' ? body.message : null
    if (!message)
      return new Response('message is required unless mode=inspect', {
        status: 400,
      })
    const turn = await disposeRpcResult(
      await stub.runThreadFixtureTurn(threadId, { clear: true, message }),
    )
    const [afterPrompt, workspace] = await Promise.all([
      disposeRpcResult(await stub.debugThreadPrompt(threadId)),
      disposeRpcResult(await stub.debugThreadWorkspace(threadId)),
    ])
    return Response.json({
      ...base,
      turn,
      afterTurn: {
        hasSkillsPrompt: afterPrompt.prompt.includes('Available skills'),
        skillPaths: workspace.samplePaths
          .map((entry) => entry.path)
          .filter((path) => path.includes('/.agents/skills/')),
      },
    })
  }

  if (target === 'issue-run' || target === 'issue-run-work') {
    const [{ number: maxNumber }] = await db
      .select({ number: max(schema.issue.number) })
      .from(schema.issue)
      .where(eq(schema.issue.workspaceId, workspaceId))
    const issueId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    await db.transaction(async (tx) => {
      await tx.insert(schema.issue).values({
        id: issueId,
        workspaceId,
        number: (maxNumber ?? 0) + 1,
        title:
          target === 'issue-run-work'
            ? '[fixture] issue run light work'
            : '[fixture] issue run',
        description:
          typeof body.message === 'string'
            ? body.message
            : 'Fixture issue run.',
        status: 'backlog',
        priority: 'medium',
        assigneeType: 'agent',
        assigneeId: agent.id,
        createdBy: userId,
      })
      await tx.insert(schema.issueRun).values({
        id: runId,
        workspaceId,
        issueId,
        agentId: agent.id,
        hostName,
        status: 'queued',
        triggerSource: 'manual',
      })
      await tx
        .update(schema.issue)
        .set({ activeRunId: runId })
        .where(eq(schema.issue.id, issueId))
    })
    const base = {
      ok: true,
      target,
      agentId: agent.id,
      hostName,
      issueId,
      runId,
    }
    if (body.mode === 'inspect') return Response.json(base)
    await disposeRpcResult(await stub.startIssueRunWorkflow({ issueId, runId }))
    return Response.json({ ...base, workflowStarted: true })
  }

  const automationId = crypto.randomUUID()
  const runId = crypto.randomUUID()
  await db.insert(schema.automation).values({
    id: automationId,
    workspaceId,
    title:
      target === 'automation-schedule'
        ? '[fixture] automation schedule'
        : '[fixture] automation run',
    description:
      typeof body.message === 'string'
        ? body.message
        : 'Fixture automation run.',
    assigneeAgentId: agent.id,
    priority: 'medium',
    status: 'active',
    concurrencyPolicy: 'skip',
    createdBy: userId,
    systemPrompt:
      typeof body.message === 'string'
        ? body.message
        : 'Inspect runtime and report readiness.',
  })

  if (target === 'automation-schedule') {
    const triggerId = crypto.randomUUID()
    const nextRunAt = new Date(Date.now() + 3_000)
    await db.insert(schema.automationTrigger).values({
      id: triggerId,
      automationId,
      kind: 'schedule',
      enabled: true,
      label: '[fixture] schedule',
      cronExpression: '* * * * *',
      timezone: 'UTC',
    })
    const triggerStub = env.AUTOMATION_TRIGGER.get(
      env.AUTOMATION_TRIGGER.idFromName(triggerId),
    )
    const installResult = Result.deserialize<void, { message?: string }>(
      (await triggerStub.install({
        triggerId,
        automationId,
        concurrencyPolicy: 'skip',
        nextRunAt,
      })) as unknown,
    )
    if (installResult.isErr()) {
      return new Response(installResult.error.message ?? 'Install failed', {
        status: 500,
      })
    }

    const base = {
      ok: true,
      target,
      agentId: agent.id,
      hostName,
      automationId,
      triggerId,
      nextRunAt: nextRunAt.toISOString(),
    }
    return Response.json({ ...base, scheduled: true })
  }

  await db.insert(schema.automationRun).values({
    id: runId,
    workspaceId,
    automationId,
    source: 'manual',
    status: 'queued',
    agentId: agent.id,
    hostName,
    triggerPayload: {},
  })
  const base = {
    ok: true,
    target,
    agentId: agent.id,
    hostName,
    automationId,
    runId,
  }
  if (body.mode === 'inspect') return Response.json(base)
  await disposeRpcResult(await stub.startAutomationRunWorkflow({ runId }))
  return Response.json({ ...base, workflowStarted: true })
}

/**
 * Captures attribution fields before an agent request enters the Durable Object.
 * The websocket incident showed that a 101 handoff can fail after auth but before
 * completion logging, leaving high-volume traffic unattributed. These fields log
 * only routing/shape metadata, never websocket keys or query values, so future
 * reconnect storms can be traced to the authenticated user/workspace that opened
 * the channel.
 */
function agentRequestAuditFields(request: Request) {
  const url = new URL(request.url)
  const upgrade = request.headers.get('upgrade')?.toLowerCase() ?? null

  return {
    route: 'agent',
    upgrade,
    isWebSocket: upgrade === 'websocket',
    hasPartyKitKey: url.searchParams.has('_pk'),
    userAgent: request.headers.get('user-agent'),
    country: request.headers.get('cf-ipcountry'),
  }
}

async function authorizeAgentRequest(
  request: Request,
  env: ServerEnv,
  logger: GardenLogger,
) {
  const agentRuntimeName = getAgentRuntimeNameFromRequest(request)
  if (!agentRuntimeName) {
    return {
      request,
      response: new Response('Not found', { status: 404 }),
      userId: null,
    }
  }

  const auth = createAuth(env, request)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    logger.warn('agent.request.unauthorized')
    return {
      request,
      response: new Response('Unauthorized', { status: 401 }),
      userId: null,
    }
  }

  const userLogger = logger.child({ userId: session.user.id })

  const cacheKey = `${session.user.id}:${agentRuntimeName}`
  const now = Date.now()
  let access = agentDoAuthCache.get(cacheKey) ?? null
  if (!access || access.expiresAt <= now) {
    const accessResult = await requireAgentAccess(
      env,
      agentRuntimeName,
      session,
      'connect',
    )
    if (accessResult.isErr()) {
      userLogger.warn('agent.request.access_denied', {
        agentRuntimeName,
        message: accessResult.error.message,
      })
      return {
        request,
        response: new Response('Not found', { status: 404 }),
        userId: session.user.id,
      }
    }

    access = {
      ...accessResult.value,
      expiresAt: now + AGENT_DO_AUTH_CACHE_TTL_MS,
    }
    agentDoAuthCache.set(cacheKey, access)
  }

  userLogger.info('agent.request.connecting', {
    ...agentRequestAuditFields(request),
    agentRuntimeName,
    agentId: access.agentId,
    workspaceId: access.workspaceId,
  })

  return { request, response: null, userId: session.user.id }
}

function requestCompletionFields(
  response: Response,
  startedAt: number,
  extra?: GardenLogFields,
) {
  return {
    ...responseFields(response, startedAt),
    ...extra,
  }
}

/**
 * Logs framework-returned 5xx responses before they leave the Worker. The
 * TanStack app handler can convert a thrown route error into a generic HTTP 500
 * response, which means the top-level `Result.tryPromise` sees success and old
 * logs only said `web.request.completed`. This logging-only boundary keeps the
 * original response unchanged but records status, route, duration, and a small
 * redacted body preview so opaque `HTTPError` responses are searchable.
 */
async function logReturnedErrorResponse(input: {
  event: string
  response: Response
  startedAt: number
  logger: GardenLogger
  fields?: GardenLogFields
}) {
  if (input.response.status < 500 || input.response.status > 599) return

  const bodyPreviewResult = await Result.tryPromise({
    try: async () => await input.response.clone().text(),
    catch: (cause) => cause,
  })

  input.logger.error(input.event, {
    ...requestCompletionFields(input.response, input.startedAt, input.fields),
    ...(bodyPreviewResult.isOk()
      ? { responseBodyPreview: bodyPreviewResult.value.slice(0, 1_000) }
      : {
          responseBodyPreview: '[unavailable]',
          ...errorFields(bodyPreviewResult.error),
        }),
  })
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: ServerEnv,
    ctx: ExecutionContext,
  ) {
    bindAppEnv(env)

    ctx.waitUntil(
      reconcile(env).then((result) => {
        if (result.isErr()) {
          webLogger.error('issue_run.reconcile.failed', {
            message: result.error.message,
          })
        }
      }),
    )
  },

  async fetch(request: Request, env: ServerEnv, ctx?: ExecutionContext) {
    bindAppEnv(env)
    scheduleFetchReconcile(env, ctx)

    const startedAt = performance.now()
    const baseRequestFields = requestFields(request)
    const logger = webLogger.child(baseRequestFields)

    const sandboxResponse = await proxyToSandbox(request, env)
    if (sandboxResponse) {
      const response = withRequestIdHeader(
        sandboxResponse,
        baseRequestFields.requestId,
      )
      await logReturnedErrorResponse({
        event: 'web.request.response_error',
        response,
        startedAt,
        logger,
        fields: { route: 'sandbox' },
      })
      return response
    }

    const url = new URL(request.url)

    if (url.pathname === '/api/dev/chat-agent-fixture') {
      return await handleChatAgentFixtureRequest(request, env)
    }

    if (url.pathname.startsWith('/agents/')) {
      const agentAuth = await authorizeAgentRequest(request, env, logger)
      if (agentAuth.response) {
        const response = withRequestIdHeader(
          agentAuth.response,
          baseRequestFields.requestId,
        )
        await logReturnedErrorResponse({
          event: 'web.request.response_error',
          response,
          startedAt,
          logger,
          fields: {
            route: 'agent-auth',
            ...(agentAuth.userId ? { userId: agentAuth.userId } : {}),
          },
        })
        return response
      }

      const agentLogger = agentAuth.userId
        ? logger.child({ userId: agentAuth.userId })
        : logger
      const agentResponse = await Result.tryPromise({
        try: async () => await routeAgentDoRequest(agentAuth.request, env),
        catch: (cause) => cause,
      })
      if (agentResponse.isErr()) {
        return responseFromCaughtError({
          event: 'agent.request.failed',
          status: 502,
          fallback: 'Agent request failed',
          cause: agentResponse.error,
          logger: agentLogger,
        })
      }

      if (agentResponse.value) {
        const response = withRequestIdHeader(
          agentResponse.value,
          baseRequestFields.requestId,
        )
        await logReturnedErrorResponse({
          event: 'web.request.response_error',
          response,
          startedAt,
          logger: agentLogger,
          fields: { route: 'agent' },
        })
        return response
      }
    }

    const appContext = createAppRequestContext(env, request)
    const appResponse = await Result.tryPromise({
      try: async () =>
        handler.fetch(request, {
          context: appContext,
        }),
      catch: (cause) => cause,
    })

    const cachedSession = appContext.auth.getCachedSession()
    const sessionResult = cachedSession
      ? await Result.tryPromise({
          try: async () => await cachedSession,
          catch: (cause) => cause,
        })
      : null
    if (sessionResult?.isErr()) {
      logger.warn('auth.session.log_context_failed', errorFields(sessionResult.error))
    }
    const session = sessionResult?.isOk() ? sessionResult.value : null
    const appLogger = session?.user?.id
      ? logger.child({ userId: session.user.id })
      : logger

    if (appResponse.isOk()) {
      const response = withRequestIdHeader(
        appResponse.value,
        baseRequestFields.requestId,
      )
      return response
    }

    return responseFromCaughtError({
      event: 'web.request.failed',
      status: 500,
      fallback: 'Application request failed',
      cause: appResponse.error,
      logger: appLogger,
    })
  },
} satisfies ExportedHandler<ServerEnv>
