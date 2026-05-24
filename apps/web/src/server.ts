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

  const stub = await getAgentByName(env.AgentDO, hostName)
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
      hasLoadContextTool: toolNames.includes('load_context'),
      hasSkillsPrompt: prompt.prompt.includes('Available workspace skills'),
      loadedSkillKeys: prompt.loadedSkillKeys,
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
        loadedSkillKeys: afterPrompt.loadedSkillKeys,
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

  async fetch(request: Request, env: ServerEnv, ctx?: ExecutionContext) {
    bindAppEnv(env)
    scheduleFetchReconcile(env, ctx)

    const sandboxResponse = await proxyToSandbox(request, env)
    if (sandboxResponse) return sandboxResponse

    const url = new URL(request.url)

    if (url.pathname === '/api/dev/chat-agent-fixture') {
      return await handleChatAgentFixtureRequest(request, env)
    }

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
