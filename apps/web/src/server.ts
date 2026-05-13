import handler from '@tanstack/react-start/server-entry'
import { getAgentByName } from 'agents'
import {
  AgentDO,
  AutomationRunSubAgent,
  AutomationTriggerDO,
  ChatSubAgent,
  IssueRunSubAgent,
  RunWorkflow,
  consumeRunDispatchBatch,
  type RunDispatchBatch,
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
const agentDoAuthCache = new Map<string, number>()
let lastFetchReconcileAt = 0

function scheduleFetchReconcile(env: ServerEnv, ctx?: ExecutionContext) {
  const now = Date.now()
  if (now - lastFetchReconcileAt < RECONCILE_ON_FETCH_INTERVAL_MS) return
  lastFetchReconcileAt = now

  const task = reconcile(env).then((result) => {
    if (result.isErr()) {
      console.error({
        event: 'issue_run_reconcile_failed',
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
}) {
  const message =
    args.cause instanceof Error ? args.cause.message : args.fallback
  console.error({
    event: args.event,
    message,
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

  const agent = await getAgentByName(env.AgentDO, agentRuntimeName)
  return await agent.fetch(routedRequest)
}

async function authorizeAgentRequest(request: Request, env: ServerEnv) {
  const agentRuntimeName = getAgentRuntimeNameFromRequest(request)
  if (!agentRuntimeName) {
    return { request, response: new Response('Not found', { status: 404 }) }
  }

  const auth = createAuth(env, request)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return { request, response: new Response('Unauthorized', { status: 401 }) }
  }

  const cacheKey = `${session.user.id}:${agentRuntimeName}`
  const cachedUntil = agentDoAuthCache.get(cacheKey) ?? 0
  const now = Date.now()
  if (cachedUntil <= now) {
    const accessResult = await requireAgentAccess(
      env,
      agentRuntimeName,
      session,
      'connect',
    )
    if (accessResult.isErr()) {
      return { request, response: new Response('Not found', { status: 404 }) }
    }

    agentDoAuthCache.set(cacheKey, now + AGENT_DO_AUTH_CACHE_TTL_MS)
  }

  return { request, response: null }
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
          console.error({
            event: 'issue_run_reconcile_failed',
            message: result.error.message,
          })
        }
      }),
    )
  },

  async queue(batch: MessageBatch<unknown>, env: ServerEnv): Promise<void> {
    bindAppEnv(env)
    await consumeRunDispatchBatch(
      env as unknown as Parameters<typeof consumeRunDispatchBatch>[0],
      batch as unknown as RunDispatchBatch,
    )
  },

  async fetch(request: Request, env: ServerEnv, ctx?: ExecutionContext) {
    bindAppEnv(env)
    scheduleFetchReconcile(env, ctx)

    const sandboxResponse = await proxyToSandbox(request, env)
    if (sandboxResponse) return sandboxResponse

    const url = new URL(request.url)

    if (url.pathname.startsWith('/agents/')) {
      const agentAuth = await authorizeAgentRequest(request, env)
      if (agentAuth.response) return agentAuth.response

      const agentResponse = await Result.tryPromise({
        try: async () => await routeAgentDoRequest(agentAuth.request, env),
        catch: (cause) => cause,
      })
      if (agentResponse.isErr()) {
        return responseFromCaughtError({
          event: 'agent_route_request_failed',
          status: 502,
          fallback: 'Agent request failed',
          cause: agentResponse.error,
        })
      }

      if (agentResponse.value) return agentResponse.value
    }

    const appResponse = await Result.tryPromise({
      try: async () => handler.fetch(request),
      catch: (cause) => cause,
    })

    return appResponse.isOk()
      ? appResponse.value
      : responseFromCaughtError({
          event: 'web_handler_failed',
          status: 500,
          fallback: 'Application request failed',
          cause: appResponse.error,
        })
  },
} satisfies ExportedHandler<ServerEnv>
