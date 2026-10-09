import { WorkerEntrypoint } from 'cloudflare:workers'
import { getAgentByName, getSubAgentByName } from 'agents'
import { IssueRunSubAgent } from '../src/issue-run-sub-agent'
import { AgentDO } from '../src/agent-do'
import { RunWorkflow } from '../src/run-workflow'
import { Effect } from 'effect'
import { Result } from 'better-result'
import { Brain } from '@garden/brain/services/brain'
import { makeWorkerBrainLive } from '@garden/brain/services/worker'
import { createBrainTools } from '../src/agent-tools/brain'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import type { BrainScope } from '@garden/brain/domain/scope'

export { AgentDO, RunWorkflow }
export { IssueRunSubAgent }
export { AutomationRunSubAgent } from '../src/automation-run-sub-agent'
export { ChatSubAgent } from '../src/agent-do'
import { BrainWriteBackSubAgent } from '../src/brain-write-back-sub-agent'
export { BrainWriteBackSubAgent }
// The application injects this exact export with @cloudflare/codemode/vite.
export { CodemodeRuntime } from '@cloudflare/codemode'
export {
  ExecutorMcpSession,
  ExecutorMcpExecutionOwnerDirectory,
} from '../../../apps/web/src/lib/server/executor-engine/mcp'

/**
 * Replaces only the external embedding provider in the disposable runtime.
 * Identical nonzero vectors keep synthetic records equally discoverable so
 * denied records cannot disappear merely because semantic ranking missed them.
 */
export class FixtureEmbeddings extends WorkerEntrypoint {
  async run(_model: string, input: { text: string[] }) {
    return {
      data: input.text.map(() =>
        Array.from({ length: 384 }, () => 1 / Math.sqrt(384)),
      ),
    }
  }
}

/** Disabled automation browser capability must never reach the external provider. */
export class FixtureBrowser extends WorkerEntrypoint {
  async fetch() {
    console.error('G08_UNEXPECTED_BROWSER_CALL')
    return new Response('Browser provider is forbidden in this fixture', {
      status: 503,
    })
  }
}

/**
 * Test-only HTTP entry into the unchanged AgentDO/Workflow/facet boundary.
 * Production authorization, database access, Brain services and persistence
 * remain in their real implementations; this Worker never deploys.
 */
export default {
  async fetch(
    request: Request,
    env: {
      AgentDO: DurableObjectNamespace<AgentDO>
      AI: FixtureEmbeddings
      BRAIN_FILES: R2Bucket
      HELIX_URL: string
      RUN_WORKFLOW: Workflow
    },
  ) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/')
      return new Response('ready')
    if (request.method === 'GET' && url.pathname === '/workflow-status') {
      const runId = url.searchParams.get('runId')
      if (!runId) return new Response('Missing runId', { status: 400 })
      const workflow = await env.RUN_WORKFLOW.get(runId)
      return Response.json(await workflow.status())
    }
    if (
      request.method !== 'POST' ||
      ![
        '/seed',
        '/link',
        '/snapshot',
        '/brain-tool',
        '/inspect',
        '/audience-fault',
        '/start',
        '/automation-start',
        '/automation-turn',
        '/issue-turn',
        '/writeback-origin',
        '/automation-resume',
        '/history',
        '/chat',
        '/resume',
        '/writeback',
      ].includes(url.pathname)
    )
      return new Response('Not found', { status: 404 })
    if (url.pathname === '/audience-fault') {
      const input = await request.json<{
        workspaceId: string
        failRead: boolean
        failPersist?: boolean
        beforeTurn?: boolean
      }>()
      let durableReads = 0
      let cacheReads = 0
      const stamps: unknown[] = []
      // Call the real production guard with a fault host. No SDK code or
      // production instance is patched; this proves the guard's read wiring.
      const guard = Reflect.get(
        IssueRunSubAgent.prototype,
        'ensureBrainAudience',
      ) as (
        this: unknown,
        workspaceId: string,
        initializeEmpty: boolean,
      ) => Promise<{ isErr(): boolean; error?: { code: string } }>
      const host = {
        getConfig: () => null,
        getMessages: async () => {
          cacheReads++
          return []
        },
        session: {
          getHistory: async () => {
            durableReads++
            if (input.failRead)
              throw new Error('Injected durable-history failure')
            return input.failPersist
              ? []
              : [
                  {
                    role: 'assistant',
                    content: 'G06_RETAINED_PRIVATE_HISTORY',
                  },
                ]
          },
        },
        configure: (config: unknown) => {
          if (input.failPersist)
            throw new Error('Injected audience persistence failure')
          stamps.push(config)
        },
      }
      const result = input.beforeTurn
        ? await Result.tryPromise({
            try: () =>
              Reflect.get(IssueRunSubAgent.prototype, 'beforeTurn').call(
                {
                  ...host,
                  currentRunId: 'fault-run',
                  loadTurnContext: async () =>
                    Result.ok({ runState: { workspaceId: input.workspaceId } }),
                  applyRunBoundaryGuards: async () => Result.ok('continue'),
                  ensureBrainAudience: (
                    workspaceId: string,
                    initializeEmpty: boolean,
                  ) => guard.call(host, workspaceId, initializeEmpty),
                },
                { body: { run_id: 'fault-run' } },
              ),
            catch: (error) => error as { code: string },
          })
        : await guard.call(host, input.workspaceId, true)
      return Response.json({
        denied: result.isErr(),
        code: result.error?.code,
        durableReads,
        cacheReads,
        stamps,
      })
    }
    if (url.pathname === '/brain-tool') {
      const input = await request.json<{
        workspaceId: string
        agentId: string
        runId: string
        userId: string
        name: string
        shared?: boolean
        args: unknown
      }>()
      const tools = createBrainTools({
        env,
        ai: env.AI,
        files: env.BRAIN_FILES,
        getContext: () => ({
          ...input,
          ...(input.shared === false ? {} : { readAudience: 'org' as const }),
        }),
      })
      const operation = tools[input.name]
      if (!operation?.execute)
        return new Response('Unknown tool', { status: 400 })
      return Response.json(
        await operation.execute(input.args as never, {
          toolCallId: crypto.randomUUID(),
          messages: [],
        }),
      )
    }
    if (url.pathname === '/inspect') {
      const input = await request.json<{
        workspaceId: string
        itemId: string
        userId: string
        teamIds?: string[]
      }>()
      const snapshot = await Effect.runPromise(
        Effect.flatMap(Brain, (brain) =>
          Effect.all({
            item: brain.read(
              ItemId.make(input.itemId),
              WorkspaceId.make(input.workspaceId),
              { userId: input.userId, teamIds: new Set(input.teamIds ?? []) },
            ),
            neighborhood: brain.neighborhood({
              tenantId: WorkspaceId.make(input.workspaceId),
              itemId: ItemId.make(input.itemId),
              viewer: {
                userId: input.userId,
                teamIds: new Set(input.teamIds ?? []),
              },
            }),
          }),
        ).pipe(
          Effect.provide(
            makeWorkerBrainLive({
              baseUrl: env.HELIX_URL,
              ai: env.AI,
              files: env.BRAIN_FILES,
            }),
          ),
        ),
      )
      return Response.json(snapshot)
    }
    if (url.pathname === '/snapshot') {
      const input = await request.json<{ workspaceId: string }>()
      const hits = await Effect.runPromise(
        Effect.flatMap(Brain, (brain) =>
          brain.search({
            tenantId: WorkspaceId.make(input.workspaceId),
            query: 'G06',
            k: 100,
            viewer: { userId: undefined, teamIds: new Set<string>() },
          }),
        ).pipe(
          Effect.provide(
            makeWorkerBrainLive({
              baseUrl: env.HELIX_URL,
              ai: env.AI,
              files: env.BRAIN_FILES,
            }),
          ),
        ),
      )
      return Response.json(hits)
    }
    if (url.pathname === '/link') {
      const input = await request.json<{
        workspaceId: string
        from: string
        to: string
      }>()
      const linked = await Effect.runPromise(
        Effect.flatMap(Brain, (brain) =>
          brain.linkItems({
            tenantId: WorkspaceId.make(input.workspaceId),
            from: ItemId.make(input.from),
            to: ItemId.make(input.to),
            edge: 'RELATED_TO',
            actor: { _tag: 'Agent', agentId: 'fixture', runId: 'fixture' },
          }),
        ).pipe(
          Effect.provide(
            makeWorkerBrainLive({
              baseUrl: env.HELIX_URL,
              ai: env.AI,
              files: env.BRAIN_FILES,
            }),
          ),
        ),
      )
      return Response.json(linked)
    }
    if (new URL(request.url).pathname === '/seed') {
      const input = await request.json<{
        workspaceId: string
        label: string
        scope: BrainScope
      }>()
      const item = await Effect.runPromise(
        Effect.flatMap(Brain, (brain) =>
          brain.ensureIndexes().pipe(
            Effect.flatMap(() =>
              brain.addText({
                tenantId: WorkspaceId.make(input.workspaceId),
                label: input.label,
                // Give every audience the same lexical relevance to real
                // start/resume queries. Real ranking must cross the production
                // injection floor; authorization alone selects visible items.
                body: [
                  input.label,
                  'Start this automation run using the injected automation context. Complete the task directly, then call complete_automation. Respect the injected closure controls: do not create issues, update GitHub, draft PRs, update QA artifacts, or mutate source unless the run payload explicitly enables that closure action.',
                  'Resume this automation run using the injected automation context. Complete required work, then call complete_automation with the final result.',
                  'Start this issue run using the injected issue context. Produce a useful work product, ask one focused question, mark blocked, or decompose into child issues.',
                  'Resume this issue run using the latest issue context. If the user answered a pending question, use that answer now.',
                ].join('\n'),
                summary: input.label,
                scope: input.scope,
                actor: { _tag: 'Agent', agentId: 'fixture', runId: 'fixture' },
              }),
            ),
          ),
        ).pipe(
          Effect.provide(
            makeWorkerBrainLive({
              baseUrl: env.HELIX_URL,
              ai: env.AI,
              files: env.BRAIN_FILES,
            }),
          ),
        ),
      )
      return Response.json(item)
    }
    if (url.pathname === '/writeback-origin') {
      const input = await request.json<{
        agentId: string
        claimedAgentId: string
        runKind: 'issue' | 'automation'
        runId: string
        originObjectId: string
        workspaceId: string
        ownerUserId: string
      }>()
      const agent = await getAgentByName(env.AgentDO, input.agentId)
      const facet = await getSubAgentByName(
        agent,
        BrainWriteBackSubAgent,
        `probe:${crypto.randomUUID()}`,
      )
      const result = await Result.tryPromise({
        try: () =>
          facet.runWriteBack({
            ...input,
            agentId: input.claimedAgentId,
            summary: 'Origin binding probe.',
          }),
        catch: (cause) => String(cause),
      })
      return Response.json(
        result.match({
          ok: (value) => ({ ok: true, value }),
          err: (error) => ({ ok: false, error }),
        }),
      )
    }
    if (url.pathname === '/automation-turn' || url.pathname === '/issue-turn') {
      const input = await request.json<{
        agentId: string
        issueId: string
        runId: string
        mode: 'start' | 'resume'
        turn: number
      }>()
      const agent = await getAgentByName(env.AgentDO, input.agentId)
      const result = await Result.tryPromise({
        try: () =>
          url.pathname === '/automation-turn'
            ? agent.executeAutomationRunTurn(input)
            : agent.executeRunTurn(input),
        catch: (cause) => String(cause),
      })
      return Response.json(
        result.match({
          ok: (value) => ({ ok: true, value }),
          err: (error) => ({ ok: false, error }),
        }),
      )
    }
    if (url.pathname === '/writeback') {
      const input = await request.json<{
        agentId: string
        runId: string
        workspaceId: string
        ownerUserId: string
      }>()
      const agent = await getAgentByName(env.AgentDO, input.agentId)
      const facet = await getSubAgentByName(
        agent,
        BrainWriteBackSubAgent,
        input.runId,
      )
      return Response.json(
        await facet.runWriteBack({
          ...input,
          runKind: 'automation',
          originObjectId: input.runId,
          summary: 'Inspect G06 knowledge. No new durable claim is present.',
        }),
      )
    }
    const input = await request.json<{
      agentId: string
      issueId: string
      runId: string
      threadId?: string
    }>()
    const agent = await getAgentByName(env.AgentDO, input.agentId)
    if (url.pathname === '/history') {
      const facet = await getSubAgentByName(
        agent,
        IssueRunSubAgent,
        input.issueId,
      )
      await facet.addMessages([
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [{ type: 'text', text: 'G06_LEGACY_PRIVATE_TRANSCRIPT' }],
        },
      ])
      return Response.json({ messages: await facet.getMessages() })
    }
    if (url.pathname === '/chat') {
      return Response.json(
        await agent.runThreadFixtureTurn(input.threadId!, {
          message: 'Search G06 memory and summarize what you can see.',
        }),
      )
    }
    if (url.pathname === '/resume' || url.pathname === '/automation-resume') {
      const workflow = await env.RUN_WORKFLOW.get(input.runId)
      await workflow.sendEvent({
        type: 'run-control',
        payload: { kind: 'resume' },
      })
      return Response.json({ resumed: input.runId })
    }
    if (url.pathname === '/automation-start') {
      await agent.startAutomationRunWorkflow({ runId: input.runId })
      return Response.json({ started: input.runId })
    }
    await agent.startIssueRunWorkflow({
      issueId: input.issueId,
      runId: input.runId,
    })
    return Response.json({ started: input.runId })
  },
}
