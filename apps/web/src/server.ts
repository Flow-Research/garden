import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
import { AgentHost, WorkspaceAgent } from '@garden/agent-runtime'
import { proxyToSandbox, Sandbox } from '@cloudflare/sandbox'
import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createAuth } from '@/lib/auth'
import { getDb, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'
import { reconcile } from '@/lib/server/issue-run-reconciler'

export { AgentHost }
export { WorkspaceAgent }
export { Sandbox }

type ServerEnv = AppEnv & {
  MCP_PROXY?: Fetcher
}

const AGENT_HOST_AUTH_CACHE_TTL_MS = 60_000
const agentHostAuthCache = new Map<string, number>()
const AGENT_HOST_NAME_PATTERN = /^[A-Za-z0-9._-]+$/

function responseFromCaughtError(args: {
  event: string
  status: number
  fallback: string
  cause: unknown
}) {
  const message = args.cause instanceof Error ? args.cause.message : args.fallback
  console.error({
    event: args.event,
    message,
  })

  return Response.json(
    {
      error: args.fallback,
    },
    {
      status:
        args.status >= 200 && args.status <= 599 ? args.status : 500,
    },
  )
}

function getAgentHostNameFromRequest(request: Request) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'agents' || parts[1] !== 'agent-host') return null

  const hostName = parts[2] ?? ''
  if (!hostName || !AGENT_HOST_NAME_PATTERN.test(hostName)) return null

  return hostName
}

async function authorizeAgentRequest(request: Request, env: ServerEnv) {
  const hostName = getAgentHostNameFromRequest(request)
  if (!hostName) {
    return { request, response: new Response('Not found', { status: 404 }) }
  }

  const auth = createAuth(env, request)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return { request, response: new Response('Unauthorized', { status: 401 }) }
  }

  const cacheKey = `${session.user.id}:${hostName}`
  const cachedUntil = agentHostAuthCache.get(cacheKey) ?? 0
  const now = Date.now()
  if (cachedUntil <= now) {
    const db = getDb(env)
    const [row] = await db
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.hostName, hostName),
          eq(schema.agent.ownerUserId, session.user.id),
        ),
      )
      .limit(1)

    if (!row) {
      return { request, response: new Response('Not found', { status: 404 }) }
    }

    agentHostAuthCache.set(cacheKey, now + AGENT_HOST_AUTH_CACHE_TTL_MS)
  }

  return { request, response: null }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: ServerEnv,
    ctx: ExecutionContext,
  ) {
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

  async fetch(request: Request, env: ServerEnv) {
    const sandboxResponse = await proxyToSandbox(request, env)
    if (sandboxResponse) return sandboxResponse

    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/mcp-proxy/')) {
      if (!env.MCP_PROXY) {
        return new Response('MCP proxy binding is not configured', { status: 503 })
      }

      const upstreamPath = url.pathname.replace('/api/mcp-proxy', '')
      const upstreamUrl = new URL(
        `${upstreamPath}${url.search}`,
        'https://garden-mcp-proxy.internal',
      )
      const proxyResponse = await Result.tryPromise({
        try: async () => env.MCP_PROXY!.fetch(new Request(upstreamUrl, request)),
        catch: (cause) => cause,
      })

      return proxyResponse.isOk()
        ? proxyResponse.value
        : responseFromCaughtError({
            event: 'mcp_proxy_service_binding_failed',
            status: 502,
            fallback: 'MCP proxy request failed',
            cause: proxyResponse.error,
          })
    }

    if (url.pathname.startsWith('/agents/')) {
      const agentAuth = await authorizeAgentRequest(request, env)
      if (agentAuth.response) return agentAuth.response

      const agentResponse = await Result.tryPromise({
        try: async () => routeAgentRequest(agentAuth.request, env),
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
