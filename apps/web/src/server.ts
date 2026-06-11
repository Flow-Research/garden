import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
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
import { createAuth } from '@/lib/auth'
import type { AppEnv } from '@/lib/server/env'
import { bindAppEnv } from '@/lib/server/env'
import {
  isAgentRuntimeName,
  requireAgentAccess,
} from '@/lib/server/agent-do-router'
import { reconcile } from '@/lib/server/issue-run-reconciler'
import {
  createGardenLogger,
  errorFields,
  requestFields,
  responseFields,
  withRequestIdHeader,
  type GardenLogger,
  type GardenLogFields,
} from '@garden/observability/logger'
import {
  createAppRequestContext,
  getLoggedAuthSession,
} from '@/lib/server/context'

export { AgentDO }
export { AutomationRunSubAgent }
export { AutomationTriggerDO }
export { ChatSubAgent }
export { IssueRunSubAgent }
export { RunWorkflow }
export { Sandbox }

type ServerEnv = AppEnv

const AGENT_DO_AUTH_CACHE_TTL_MS = 60_000
const AGENT_ROUTING_RETRY = { maxAttempts: 3 }
type AgentDoAuthCacheEntry = {
  expiresAt: number
  agentId: string
  workspaceId: string
}
const agentDoAuthCache = new Map<string, AgentDoAuthCacheEntry>()
const webLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'worker-entry',
})

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

/**
 * Route authenticated agent HTTP/WebSocket traffic through the SDK router.
 *
 * Before this used `getAgentByName(...).fetch(...)`, which performs an extra
 * RPC `setName()` handshake meant for RPC method calls. WebSocket connects then
 * logged Cloudflare's "RPC result was not disposed properly" warning before the
 * 101 handoff. The SDK router mirrors PartyServer routing: parse URL, set
 * routing headers, and call `namespace.get(id).fetch(...)` directly with retry.
 * Reference checked: installed `agents` / `partyserver` routeAgentRequest path.
 */
async function routeAgentDoRequest(request: Request, env: ServerEnv) {
  const agentRuntimeName = getAgentRuntimeNameFromRequest(request)
  if (!agentRuntimeName) return new Response('Not found', { status: 404 })

  const response = await routeAgentRequest(request, env, {
    routingRetry: AGENT_ROUTING_RETRY,
  })
  return response ?? new Response('Not found', { status: 404 })
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

  const auth = await createAuth(env, request)
  const session = await getLoggedAuthSession({
    auth,
    request,
    source: 'agent-router',
    fields: { route: 'agent', agentRuntimeName },
  })
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

  async fetch(request: Request, env: ServerEnv, _ctx?: ExecutionContext) {
    bindAppEnv(env)

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
      logger.warn(
        'auth.session.log_context_failed',
        errorFields(sessionResult.error),
      )
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
