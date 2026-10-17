import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import type { Unstable_RawConfig } from 'wrangler'
import { startInstrumentedHarness } from '../fixtures/instrumented-worker'
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import { eq } from 'drizzle-orm'

const ownerId = crypto.randomUUID()
const initiatorId = crypto.randomUUID()
const workspaceId = crypto.randomUUID()
const foreignWorkspaceId = crypto.randomUUID()
const teamId = crypto.randomUUID()
const agentId = crypto.randomUUID()
const issueId = crypto.randomUUID()
const runId = crypto.randomUUID()
const allowedMarker = 'G06_ORG_ALLOWED_MARKER'
const deniedMarkers = [
  'G06_OWNER_PRIVATE_MARKER',
  'G06_INITIATOR_PRIVATE_MARKER',
  'G06_FOREIGN_MARKER',
  'G06_TEAM_MARKER',
]
let modelMode: 'issue' | 'chat' | 'pause' = 'issue'
const seededIds: string[] = []
const modelRequests: Array<{
  messages: Array<{ role: string; content?: unknown }>
  tools?: Array<{ function: { name: string } }>
}> = []

/** Proves automatic injection independently of later explicit tool retrieval. */
function assertOrgInjection(
  request: (typeof modelRequests)[number],
  markers: string[],
) {
  const text = request.messages
    .flatMap((message) => {
      if (typeof message.content === 'string') return [message.content]
      if (!Array.isArray(message.content)) return []
      return message.content.flatMap((part: unknown) =>
        part !== null &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
          ? [part.text]
          : [],
      )
    })
    .join('\n')
  const blocks = [
    ...text.matchAll(
      /Org Brain memory for this turn\.[\s\S]*?Call brain_search or brain_neighborhood with an id above for more\./g,
    ),
  ].map((match) => match[0])
  expect(
    blocks.length,
    'automatic injection must be present before explicit retrieval',
  ).toBeGreaterThan(0)
  const injected = blocks.join('\n')
  for (const marker of markers) expect(injected).toContain(marker)
  const ids = [...injected.matchAll(/^\d+\. \[([^\]]+)\]/gm)].map(
    (match) => match[1],
  )
  expect(ids).toContain(seededIds[0])
  for (const marker of deniedMarkers)
    expect(
      injected.includes(marker),
      `automatic injection disclosed ${marker}`,
    ).toBe(false)
  for (const id of seededIds.slice(1)) expect(ids).not.toContain(id)
}

// Match apps/web/vite.config.ts source aliases so the fixture runs the same
// vendored Executor implementation, including its actual MCP/D1 storage host.
const executorSource = (path: string) =>
  fileURLToPath(
    new URL(`../../../third_party/executor/${path}`, import.meta.url),
  )
const executorAliases = {
  ...Object.fromEntries(
    ['browser-approval', 'seams', 'tool-server'].map((name) => [
      `@executor-js/host-mcp/${name}`,
      executorSource(`packages/hosts/mcp/src/${name}.ts`),
    ]),
  ),
  '@executor-js/cloudflare/mcp/agent-durable-object': executorSource(
    'packages/hosts/cloudflare/src/mcp/agent-session-durable-object.ts',
  ),
  ...Object.fromEntries(
    ['execution-owner-directory', 'session-stub'].map((name) => [
      `@executor-js/cloudflare/mcp/${name}`,
      executorSource(`packages/hosts/cloudflare/src/mcp/${name}.ts`),
    ]),
  ),
  '@executor-js/runtime-dynamic-worker': executorSource(
    'packages/kernel/runtime-dynamic-worker/src/index.ts',
  ),
  '@executor-js/plugin-encrypted-secrets': executorSource(
    'packages/plugins/encrypted-secrets/src/index.ts',
  ),
  ...Object.fromEntries(
    ['openapi', 'mcp', 'graphql'].map((name) => [
      `@executor-js/plugin-${name}/presets`,
      executorSource(`packages/plugins/${name}/src/sdk/presets.ts`),
    ]),
  ),
  '@executor-js/plugin-toolkits/server': executorSource(
    'packages/plugins/toolkits/src/server.ts',
  ),
}

/** Uses real services only when explicitly selected; the required QA command enables this suite. */
describe.skipIf(process.env.GARDEN_ITEST_HELIX !== '1')(
  'shared issue-run Brain authorization — real Worker/storage',
  () => {
    let nextIssueNumber = 2
    let database: TestDb | undefined
    let helix: StartedTestContainer | undefined
    let model: Server | undefined
    let harness:
      | Awaited<ReturnType<typeof startInstrumentedHarness>>
      | undefined

    beforeEach(async (context) => {
      nextIssueNumber = 2
      modelRequests.length = 0
      seededIds.length = 0
      modelMode = 'issue'
      database = await startTestDb()
      helix = await new GenericContainer('ghcr.io/helixdb/helixdb:v0.0.4')
        .withTmpFs({ '/var/lib/helix': 'uid=65532,gid=65532,mode=0700' })
        .withEnvironment({ HELIX_DATA_DIR: '/var/lib/helix' })
        .withExposedPorts(8080)
        // The minimal Helix image cannot execute Testcontainers' internal-port
        // shell probe. HTTP 405 proves the query listener exists; seeds below
        // additionally prove actual durable writes through the Brain service.
        .withWaitStrategy(Wait.forHttp('/v2/query', 8080).forStatusCode(405))
        .start()
      model = createServer(async (request, response) => {
        let raw = ''
        for await (const chunk of request) raw += String(chunk)
        const body = JSON.parse(raw) as (typeof modelRequests)[number]
        modelRequests.push(body)
        const toolResults = body.messages.filter(
          (message) => message.role === 'tool',
        )
        const writeback =
          body.tools?.some(
            (tool) => tool.function.name === 'propose_brain_item',
          ) ?? false
        const visibleText = JSON.stringify(body.messages)
        const observations = {
          markers: [allowedMarker, ...deniedMarkers].filter((marker) =>
            visibleText.includes(marker),
          ),
          itemIds: body.messages.flatMap((message) => {
            const content =
              typeof message.content === 'string' ? message.content : ''
            if (message.role === 'tool') {
              const result = JSON.parse(content) as {
                hits?: Array<{ id: string }>
                items?: Array<{ id: string }>
              }
              return [...(result.hits ?? []), ...(result.items ?? [])].map(
                (item) => item.id,
              )
            }
            return [...content.matchAll(/^\d+\. \[([^\]]+)\] G06_/gm)].map(
              (match) => match[1]!,
            )
          }),
        }
        const finished =
          (writeback && toolResults.length >= 3) ||
          (modelMode === 'chat' && toolResults.length >= 1)
        const toolName =
          toolResults.length === 0
            ? 'brain_search'
            : writeback
              ? 'propose_brain_item'
              : toolResults.length <= 2
                ? 'brain_neighborhood'
                : toolResults.length === 3
                  ? 'add_to_brain'
                  : toolResults.length === 4
                    ? 'post_comment'
                    : modelMode === 'pause'
                      ? 'ask_question'
                      : 'create_work_product'
        const args =
          toolResults.length === 0
            ? { query: 'G06', k: 8 }
            : writeback
              ? {
                  claim: JSON.stringify(observations),
                  kind: 'policy',
                  confidence: toolResults.length === 1 ? 0.5 : 0.9,
                  sensitive: false,
                  scope: 'org',
                }
              : toolResults.length <= 2
                ? { itemId: seededIds[toolResults.length - 1], depth: 1 }
                : toolResults.length === 3
                  ? {
                      mode: 'update',
                      itemId: seededIds[1],
                      kind: 'note',
                      summary: 'G06_DENIED_MUTATION',
                    }
                  : toolResults.length === 4
                    ? { body: JSON.stringify(observations) }
                    : modelMode === 'pause'
                      ? { question: 'Continue the G06 report?' }
                      : {
                          type: 'report',
                          title: 'Shared retrieval evidence',
                          body: JSON.stringify(observations),
                        }
        const chunk = {
          id: crypto.randomUUID(),
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [
            {
              index: 0,
              delta: finished
                ? { role: 'assistant', content: JSON.stringify(observations) }
                : {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: crypto.randomUUID(),
                        type: 'function',
                        function: {
                          name: toolName,
                          arguments: JSON.stringify(args),
                        },
                      },
                    ],
                  },
              finish_reason: null,
            },
          ],
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(
          `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finished ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
        )
      })
      model.listen(0, '127.0.0.1')
      await once(model, 'listening')
      const address = model.address()
      if (!address || typeof address === 'string')
        throw new Error('Model fixture did not bind a TCP port')

      await database.db.insert(schema.user).values([
        { id: ownerId, email: 'g06-owner@example.test' },
        { id: initiatorId, email: 'g06-initiator@example.test' },
      ])
      await database.db.insert(schema.organization).values([
        { id: workspaceId, name: 'G06', slug: workspaceId },
        { id: foreignWorkspaceId, name: 'Foreign', slug: foreignWorkspaceId },
      ])
      await database.db.insert(schema.member).values([
        { organizationId: workspaceId, userId: ownerId, role: 'owner' },
        { organizationId: workspaceId, userId: initiatorId, role: 'member' },
      ])
      await database.db.insert(schema.agent).values({
        id: agentId,
        workspaceId,
        ownerUserId: ownerId,
        name: 'G06 agent',
        hostName: agentId,
        permissions: { full_access: true },
      })
      await database.db.insert(schema.issue).values({
        id: issueId,
        workspaceId,
        number: 1,
        title: 'G06 memory report',
        createdBy: initiatorId,
        assigneeType: 'agent',
        assigneeId: agentId,
      })
      await database.db.insert(schema.issueRun).values({
        id: runId,
        workspaceId,
        issueId,
        agentId,
        hostName: agentId,
        workflowInstanceId: runId,
      })
      await database.db
        .update(schema.issue)
        .set({ activeRunId: runId })
        .where(eq(schema.issue.id, issueId))
      const config: Unstable_RawConfig = {
        name: 'garden-g06-integration',
        alias: executorAliases,
        main: fileURLToPath(
          new URL('../fixtures/brain-run-worker.ts', import.meta.url),
        ),
        compatibility_date: '2026-04-18',
        compatibility_flags: ['nodejs_compat'],
        rules: [{ type: 'Text', globs: ['**/*.md*'], fallthrough: true }],
        durable_objects: {
          bindings: [
            { name: 'AgentDO', class_name: 'AgentDO' },
            {
              name: 'EXECUTOR_MCP_SESSION',
              class_name: 'ExecutorMcpSession',
            },
            {
              name: 'EXECUTOR_MCP_EXECUTION_OWNER',
              class_name: 'ExecutorMcpExecutionOwnerDirectory',
            },
          ],
        },
        migrations: [
          {
            tag: 'fixture',
            new_sqlite_classes: [
              'AgentDO',
              'ExecutorMcpSession',
              'ExecutorMcpExecutionOwnerDirectory',
            ],
          },
        ],
        r2_buckets: [
          { binding: 'FILES', bucket_name: 'fixture-files' },
          { binding: 'BRAIN_FILES', bucket_name: 'fixture-brain' },
          { binding: 'EXECUTOR_BLOBS', bucket_name: 'fixture-executor' },
        ],
        d1_databases: [
          {
            binding: 'EXECUTOR_DB',
            database_name: 'fixture-executor',
            database_id: '00000000-0000-0000-0000-000000000000',
          },
        ],
        services: [
          {
            binding: 'AI',
            service: 'garden-g06-integration',
            entrypoint: 'FixtureEmbeddings',
          },
        ],
        workflows: [
          {
            binding: 'RUN_WORKFLOW',
            class_name: 'RunWorkflow',
            name: 'garden-g06-integration',
          },
        ],
        worker_loaders: [{ binding: 'LOADER' }],
        hyperdrive: [
          {
            binding: 'HYPERDRIVE',
            id: '00000000000000000000000000000000',
            localConnectionString: database.databaseUrl,
          },
        ],
        vars: {
          EXECUTOR_SECRET_KEY: 'g06-synthetic-encryption-key-only',
          HELIX_URL: `http://${helix.getHost()}:${helix.getMappedPort(8080)}`,
          GARDEN_MODEL_PROVIDER: 'openai-compatible',
          GARDEN_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          GARDEN_MODEL_ID: 'fixture',
          GARDEN_OFFLINE: '1',
          ENVIRONMENT: 'test',
          BETTER_AUTH_SECRET: 'synthetic-fixture-only',
          BETTER_AUTH_URL: 'http://fixture',
        },
      }
      const rolesByScenario: Record<string, string[]> = {
        'keeps owner/initiator private, foreign and team memory out of a real shared work product':
          [
            'IssueRunSubAgent.completeWorkflowTurn',
            'BrainWriteBackSubAgent.runWriteBack',
          ],
        'retains owner-private retrieval in a real private chat': [
          'ChatSubAgent.onChatResponse',
          'BrainWriteBackSubAgent.runWriteBack',
        ],
        'rejects an unproven legacy issue transcript before any model request or shared output':
          ['IssueRunSubAgent.executeWorkflowTurn'],
        'preserves org-only retrieval through a real Workflow wait/resume and a later run on the same issue facet':
          [
            'IssueRunSubAgent.completeWorkflowTurn',
            'BrainWriteBackSubAgent.runWriteBack',
          ],
        'denies private mutation targets without metadata or edge changes while allowing org mutations':
          [],
        'uses the real issue guard durable-history reader when hydration is empty or storage fails':
          [],
      }
      const expectedRoles = rolesByScenario[context.task.name]
      if (!expectedRoles)
        throw new Error('Scenario has no declared native coverage boundary')
      harness = await startInstrumentedHarness(
        config,
        expectedRoles,
        context.task.name,
      )
      await harness.listen()
      expect(await (await harness.fetch('/')).text()).toBe('ready')
      const seeds = [
        { workspaceId, label: allowedMarker, scope: { kind: 'org' } },
        {
          workspaceId,
          label: deniedMarkers[0],
          scope: { kind: 'user', userId: ownerId },
        },
        {
          workspaceId,
          label: deniedMarkers[1],
          scope: { kind: 'user', userId: initiatorId },
        },
        {
          workspaceId: foreignWorkspaceId,
          label: deniedMarkers[2],
          scope: { kind: 'org' },
        },
        {
          workspaceId,
          label: deniedMarkers[3],
          scope: { kind: 'team', teamId },
        },
      ]
      for (const seed of seeds) {
        const response = await harness.fetch('/seed', {
          method: 'POST',
          body: JSON.stringify(seed),
        })
        expect(response.status, await response.clone().text()).toBe(200)
        const item = (await response.json()) as { id: string }
        expect(item.id).toBeTypeOf('string')
        seededIds.push(item.id)
      }
      const link = await harness.fetch('/link', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          from: seededIds[0],
          to: seededIds[1],
        }),
      })
      expect(link.status, await link.clone().text()).toBe(200)
    }, 120_000)

    afterEach((context) => {
      if (context.task.result?.state === 'fail') harness?.debug()
    })

    afterEach(async () => {
      const workerCleanup = await Promise.allSettled([harness?.close()])
      const cleanup = await Promise.allSettled([
        new Promise<void>((resolve, reject) =>
          model
            ? model.close((error) => (error ? reject(error) : resolve()))
            : resolve(),
        ),
        helix?.stop(),
        database?.cleanup(),
      ])
      const failures = [...workerCleanup, ...cleanup].filter(
        (result) => result.status === 'rejected',
      )
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Fixture cleanup failed',
        )
    })

    async function seedIssue(title: string) {
      const nextIssueId = crypto.randomUUID()
      const nextRunId = crypto.randomUUID()
      await database!.db.insert(schema.issue).values({
        id: nextIssueId,
        workspaceId,
        number: nextIssueNumber++,
        title,
        createdBy: initiatorId,
        assigneeType: 'agent',
        assigneeId: agentId,
      })
      await database!.db.insert(schema.issueRun).values({
        id: nextRunId,
        workspaceId,
        issueId: nextIssueId,
        agentId,
        hostName: agentId,
        workflowInstanceId: nextRunId,
      })
      await database!.db
        .update(schema.issue)
        .set({ activeRunId: nextRunId })
        .where(eq(schema.issue.id, nextIssueId))
      return { agentId, issueId: nextIssueId, runId: nextRunId }
    }

    it('keeps owner/initiator private, foreign and team memory out of a real shared work product', async () => {
      const response = await harness!.fetch('/start', {
        method: 'POST',
        body: JSON.stringify({ agentId, issueId, runId }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      await expect
        .poll(
          async () => {
            const [run] = await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, runId))
            return run?.status
          },
          { timeout: 60_000 },
        )
        .toMatch(/^(succeeded|failed|cancelled|blocked)$/)
      const [run] = await database!.db
        .select()
        .from(schema.issueRun)
        .where(eq(schema.issueRun.id, runId))
      expect(run?.status, run?.error ?? 'Run did not succeed').toBe('succeeded')
      await expect
        .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60_000 })
        .toMatch(
          new RegExp(`agent_do\\.brain_write_back\\.completed[^\n]*${runId}`),
        )
      const products = await database!.db
        .select()
        .from(schema.issueWorkProduct)
        .where(eq(schema.issueWorkProduct.runId, runId))
      expect(products).toHaveLength(1)
      expect(products[0]!.body).toContain(allowedMarker)
      expect(modelRequests.length).toBeGreaterThanOrEqual(2)
      expect(
        modelRequests[0]!.messages.some((message) => message.role === 'tool'),
      ).toBe(false)
      assertOrgInjection(modelRequests[0]!, [allowedMarker])
      const proposals = await database!.db
        .select()
        .from(schema.brainWriteProposal)
        .where(
          eq(
            schema.brainWriteProposal.runId,
            `brain-write-back:issue:${runId}`,
          ),
        )
      expect(proposals).toHaveLength(1)
      expect(proposals[0]!.claim).toContain(allowedMarker)
      for (const marker of deniedMarkers) {
        expect(
          JSON.stringify(modelRequests).includes(marker),
          `model request disclosed ${marker}`,
        ).toBe(false)
        expect(products[0]!.body).not.toContain(marker)
        expect(proposals[0]!.claim).not.toContain(marker)
      }
      const neighborhoods = modelRequests
        .flatMap((request) => request.messages)
        .filter(
          (message) =>
            message.role === 'tool' && typeof message.content === 'string',
        )
        .map(
          (message) =>
            JSON.parse(message.content as string) as {
              items?: Array<{ id: string }>
            },
        )
        .filter((result) => result.items !== undefined)
      expect(
        neighborhoods.some((result) =>
          result.items!.some((item) => item.id === seededIds[0]),
        ),
      ).toBe(true)
      expect(
        modelRequests
          .flatMap((request) => request.messages)
          .some((message) => {
            if (message.role !== 'tool' || typeof message.content !== 'string')
              return false
            const result = JSON.parse(message.content) as {
              ok: boolean
              error?: string
            }
            return !result.ok && result.error === 'brain_neighborhood_failed'
          }),
        'direct private neighborhood must return the unavailable result',
      ).toBe(true)
      for (const result of neighborhoods)
        expect(result.items!.map((item) => item.id)).not.toContain(seededIds[1])
      const comments = await database!.db
        .select()
        .from(schema.issueComment)
        .where(eq(schema.issueComment.issueId, issueId))
      expect(comments).toHaveLength(1)
      expect(comments[0]!.body).toContain(allowedMarker)
      expect(comments[0]!.authorId).toBe(agentId)
      const snapshot = await harness!.fetch('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      })
      expect(snapshot.status, await snapshot.clone().text()).toBe(200)
      const hits = (await snapshot.json()) as Array<{
        item: {
          body: string
          scope: { kind: string }
          origin: { actor: { agentId: string; runId: string } }
        }
      }>
      const written = hits.filter(
        (hit) =>
          hit.item.origin.actor.runId === `brain-write-back:issue:${runId}`,
      )
      expect(written).toHaveLength(1)
      expect(written[0]!.item.scope.kind).toBe('org')
      expect(written[0]!.item.origin.actor.agentId).toBe(agentId)
      expect(written[0]!.item.body).toContain(allowedMarker)
      for (const marker of deniedMarkers) {
        expect(comments[0]!.body).not.toContain(marker)
        expect(written[0]!.item.body).not.toContain(marker)
      }
      const productEvidence = JSON.parse(products[0]!.body!) as {
        itemIds: string[]
      }
      const proposalEvidence = JSON.parse(proposals[0]!.claim) as {
        itemIds: string[]
      }
      expect(productEvidence.itemIds).toContain(seededIds[0])
      expect(proposalEvidence.itemIds).toContain(seededIds[0])
      for (const id of seededIds.slice(1)) {
        expect(productEvidence.itemIds).not.toContain(id)
        expect(proposalEvidence.itemIds).not.toContain(id)
      }
    }, 90_000)
    it('retains owner-private retrieval in a real private chat', async () => {
      modelMode = 'chat'
      const start = modelRequests.length
      const threadId = crypto.randomUUID()
      await database!.db.insert(schema.chatThread).values({
        id: threadId,
        runtimeKey: threadId,
        workspaceId,
        ownerUserId: ownerId,
        agentId,
        title: 'G06 private control',
      })
      const response = await harness!.fetch('/chat', {
        method: 'POST',
        body: JSON.stringify({ agentId, threadId }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      const outcome = (await response.json()) as {
        result: { status: string }
        messages: unknown[]
      }
      expect(outcome.result.status).toBe('completed')
      const observed = JSON.stringify(modelRequests.slice(start))
      expect(observed).toContain(allowedMarker)
      expect(observed).toContain(deniedMarkers[0])
      expect(JSON.stringify(outcome.messages)).toContain(deniedMarkers[0])
      for (const marker of deniedMarkers.slice(1))
        expect(observed).not.toContain(marker)
      const neighborhood = await harness!.fetch('/brain-tool', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          agentId,
          runId,
          userId: ownerId,
          shared: false,
          name: 'brain_neighborhood',
          args: { itemId: seededIds[1] },
        }),
      })
      expect(neighborhood.status, await neighborhood.clone().text()).toBe(200)
      expect(await neighborhood.text()).toContain(deniedMarkers[0])
      const writebackStart = modelRequests.length
      const writeback = await harness!.fetch('/writeback', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          agentId,
          runId: crypto.randomUUID(),
          ownerUserId: ownerId,
        }),
      })
      expect(writeback.status, await writeback.clone().text()).toBe(200)
      expect(await writeback.json()).toEqual({ status: 'completed' })
      const writebackRequests = JSON.stringify(
        modelRequests.slice(writebackStart),
      )
      expect(writebackRequests).toContain(allowedMarker)
      expect(writebackRequests).toContain(deniedMarkers[0])
      for (const marker of deniedMarkers.slice(1))
        expect(writebackRequests).not.toContain(marker)
      modelMode = 'issue'
    }, 90_000)

    it('rejects an unproven legacy issue transcript before any model request or shared output', async () => {
      const input = await seedIssue('G06 legacy transcript')
      const seed = await harness!.fetch('/history', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      expect(seed.status, await seed.clone().text()).toBe(200)
      expect(await seed.text()).toContain('G06_LEGACY_PRIVATE_TRANSCRIPT')
      const start = modelRequests.length
      const response = await harness!.fetch('/start', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      await expect
        .poll(
          async () => {
            const [run] = await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, input.runId))
            return run?.status
          },
          { timeout: 60_000 },
        )
        .toMatch(/^(succeeded|failed|cancelled|blocked)$/)
      const [run] = await database!.db
        .select()
        .from(schema.issueRun)
        .where(eq(schema.issueRun.id, input.runId))
      expect(run?.status).toBe('failed')
      expect(run?.error).toContain('unverified Brain audience')
      expect(modelRequests.slice(start)).toHaveLength(0)
      expect(
        await database!.db
          .select()
          .from(schema.issueWorkProduct)
          .where(eq(schema.issueWorkProduct.runId, input.runId)),
      ).toHaveLength(0)
    }, 90_000)
    it('preserves org-only retrieval through a real Workflow wait/resume and a later run on the same issue facet', async () => {
      modelMode = 'pause'
      const input = await seedIssue('G06 clean resume')
      const start = modelRequests.length
      const response = await harness!.fetch('/start', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      await expect
        .poll(
          async () => {
            const [run] = await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, input.runId))
            return run?.status
          },
          { timeout: 60_000 },
        )
        .toBe('waiting_for_input')
      // Local Workflows reports running while waitForEvent is pending. The
      // persisted run state proves the question; native sendEvent below must
      // advance this same Workflow to a successful second turn.
      const resumeMarker = 'G06_RESUME_ALLOWED_MARKER'
      const seed = await harness!.fetch('/seed', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          label: resumeMarker,
          scope: { kind: 'org' },
        }),
      })
      expect(seed.status, await seed.clone().text()).toBe(200)
      modelMode = 'issue'
      const resumedStart = modelRequests.length
      const resumed = await harness!.fetch('/resume', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      expect(resumed.status, await resumed.clone().text()).toBe(200)
      await expect
        .poll(
          async () => {
            const [run] = await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, input.runId))
            return run?.status
          },
          { timeout: 60_000 },
        )
        .toBe('succeeded')
      await expect
        .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60_000 })
        .toMatch(
          new RegExp(
            `agent_do\\.brain_write_back\\.completed[^\n]*${input.runId}`,
          ),
        )
      expect(JSON.stringify(modelRequests.slice(resumedStart))).toContain(
        resumeMarker,
      )
      assertOrgInjection(modelRequests[resumedStart]!, [
        allowedMarker,
        resumeMarker,
      ])
      // Preserve this live facet and history while local Hyperdrive clients close.
      const readinessStarted = Date.now()
      const connectionSamples: number[] = []
      await expect
        .poll(
          async () => {
            const result = await database!.pool.query<{ count: string }>(
              "select count(*) from pg_stat_activity where backend_type = 'client backend'",
            )
            const count = Number(result.rows[0]!.count)
            connectionSamples.push(count)
            return count
          },
          { timeout: 15_000 },
        )
        .toBeLessThanOrEqual(10)
      console.info(
        'G06 same-facet connection readiness',
        JSON.stringify({
          runId: input.runId,
          elapsedMs: Date.now() - readinessStarted,
          connectionSamples,
        }),
      )
      const nextRunId = crypto.randomUUID()
      await database!.db.insert(schema.issueRun).values({
        id: nextRunId,
        workspaceId,
        issueId: input.issueId,
        agentId,
        hostName: agentId,
        workflowInstanceId: nextRunId,
      })
      await database!.db
        .update(schema.issue)
        .set({ activeRunId: nextRunId })
        .where(eq(schema.issue.id, input.issueId))
      const next = await harness!.fetch('/start', {
        method: 'POST',
        body: JSON.stringify({ ...input, runId: nextRunId }),
      })
      expect(next.status, await next.clone().text()).toBe(200)
      await expect
        .poll(
          async () => {
            const [run] = await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, nextRunId))
            return run?.status
          },
          { timeout: 60_000 },
        )
        .toBe('succeeded')
      await expect
        .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60_000 })
        .toMatch(
          new RegExp(
            `agent_do\\.brain_write_back\\.completed[^\n]*${nextRunId}`,
          ),
        )
      const observed = JSON.stringify(modelRequests.slice(start))
      expect(observed).toContain(allowedMarker)
      for (const marker of deniedMarkers)
        expect(
          observed.includes(marker),
          `resumed run disclosed ${marker}`,
        ).toBe(false)
    }, 120_000)
    it('denies private mutation targets without metadata or edge changes while allowing org mutations', async () => {
      const inspect = async () => {
        const snapshots: unknown[] = []
        for (const [index, itemId] of seededIds.entries()) {
          const response = await harness!.fetch('/inspect', {
            method: 'POST',
            body: JSON.stringify({
              workspaceId: index === 3 ? foreignWorkspaceId : workspaceId,
              itemId,
              userId: index === 2 ? initiatorId : ownerId,
              teamIds: [teamId],
            }),
          })
          expect(response.status, await response.clone().text()).toBe(200)
          const snapshot = (await response.json()) as { item: unknown }
          expect(snapshot.item).not.toBeNull()
          snapshots.push(snapshot)
        }
        return snapshots
      }
      const before = await inspect()
      const execute = async (name: string, args: unknown, shared = true) => {
        const response = await harness!.fetch('/brain-tool', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId,
            agentId,
            runId,
            userId: ownerId,
            name,
            args,
            shared,
          }),
        })
        expect(response.status, await response.clone().text()).toBe(200)
        return (await response.json()) as {
          ok: boolean
          error?: string
          id?: string
        }
      }
      const denial = {
        ok: false,
        error: 'The Brain item is unavailable for this run.',
      }
      for (const target of [
        seededIds[1],
        seededIds[2],
        seededIds[3],
        seededIds[4],
        '999999999',
      ]) {
        expect(
          await execute('add_to_brain', {
            mode: 'update',
            itemId: target,
            kind: 'note',
            summary: 'G06_DENIED_MUTATION',
          }),
        ).toEqual(denial)
        expect(
          await execute('brain_observe_mention', {
            itemId: target,
            text: 'G06_DENIED_MENTION',
          }),
        ).toEqual(denial)
        expect(
          await execute('brain_link', {
            from: seededIds[0],
            to: target,
            edge: 'G06_DENIED_EDGE',
          }),
        ).toEqual(denial)
        expect(
          await execute('brain_link', {
            from: target,
            to: seededIds[0],
            edge: 'G06_DENIED_REVERSE',
          }),
        ).toEqual(denial)
      }
      expect(await inspect()).toEqual(before)
      for (const target of [
        seededIds[2],
        seededIds[3],
        seededIds[4],
        '999999999',
      ]) {
        expect(
          await execute(
            'add_to_brain',
            {
              mode: 'update',
              itemId: target,
              kind: 'note',
              summary: 'G06_DENIED_MUTATION',
            },
            false,
          ),
        ).toEqual(denial)
        expect(
          await execute(
            'brain_observe_mention',
            { itemId: target, text: 'G06_DENIED_MENTION' },
            false,
          ),
        ).toEqual(denial)
        expect(
          await execute(
            'brain_link',
            { from: seededIds[1], to: target, edge: 'G06_DENIED_EDGE' },
            false,
          ),
        ).toEqual(denial)
        expect(
          await execute(
            'brain_link',
            { from: target, to: seededIds[1], edge: 'G06_DENIED_REVERSE' },
            false,
          ),
        ).toEqual(denial)
      }
      expect(await inspect()).toEqual(before)
      expect(
        await execute(
          'add_to_brain',
          {
            mode: 'update',
            itemId: seededIds[1],
            kind: 'note',
            summary: 'G06_OWNER_UPDATED',
          },
          false,
        ),
      ).toMatchObject({ ok: true, id: seededIds[1] })
      expect(
        await execute(
          'brain_observe_mention',
          { itemId: seededIds[1], text: deniedMarkers[0] },
          false,
        ),
      ).toMatchObject({ ok: true, itemId: seededIds[1] })
      expect(
        await execute(
          'brain_link',
          { from: seededIds[1], to: seededIds[0], edge: 'G06_OWNER_EDGE' },
          false,
        ),
      ).toMatchObject({ ok: true })
      expect(
        await execute(
          'brain_link',
          { from: seededIds[0], to: seededIds[1], edge: 'G06_OWNER_REVERSE' },
          false,
        ),
      ).toMatchObject({ ok: true })
      const ownerSnapshot = (await inspect())[1] as {
        item: { summary: string }
        neighborhood: { edges: Array<{ edge: string }> }
      }
      expect(ownerSnapshot.item.summary).toBe('G06_OWNER_UPDATED')
      expect(ownerSnapshot.neighborhood.edges.map((edge) => edge.edge)).toEqual(
        expect.arrayContaining(['G06_OWNER_EDGE', 'G06_OWNER_REVERSE']),
      )
      const authored = await execute('add_to_brain', {
        mode: 'create',
        label: 'G06_AUTHORED_PRIVATE',
        content: 'G06_AUTHORED_PRIVATE',
        scope: 'user',
      })
      expect(authored.ok).toBe(true)
      const authoredResponse = await harness!.fetch('/inspect', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          itemId: authored.id,
          userId: ownerId,
        }),
      })
      const authoredSnapshot = (await authoredResponse.json()) as {
        item: {
          scope: { kind: string; userId: string }
          origin: { actor: { agentId: string; runId: string } }
        }
      }
      expect(authoredSnapshot.item.scope).toEqual({
        kind: 'user',
        userId: ownerId,
      })
      expect(authoredSnapshot.item.origin.actor).toMatchObject({
        agentId,
        runId,
      })

      const created = await execute('add_to_brain', {
        mode: 'create',
        label: 'G06_ORG_TARGET',
        content: 'G06_ORG_TARGET',
      })
      expect(created.ok).toBe(true)
      expect(created.id).toBeTypeOf('string')
      expect(
        await execute('add_to_brain', {
          mode: 'update',
          itemId: created.id,
          kind: 'decision',
          summary: 'G06_ORG_UPDATED',
        }),
      ).toMatchObject({ ok: true, id: created.id, kind: 'decision' })
      expect(
        await execute('brain_observe_mention', {
          itemId: created.id,
          text: 'G06_ORG_TARGET',
        }),
      ).toMatchObject({ ok: true, itemId: created.id })
      expect(
        await execute('brain_link', {
          from: seededIds[0],
          to: created.id,
          edge: 'G06_ORG_EDGE',
        }),
      ).toMatchObject({ ok: true, from: seededIds[0], to: created.id })
      const positive = await harness!.fetch('/inspect', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          itemId: created.id,
          userId: ownerId,
        }),
      })
      const persisted = (await positive.json()) as {
        item: { summary: string }
        neighborhood: { edges: Array<{ edge: string }> }
      }
      expect(persisted.item.summary).toBe('G06_ORG_UPDATED')
      expect(
        persisted.neighborhood.edges.some(
          (edge) => edge.edge === 'G06_ORG_EDGE',
        ),
      ).toBe(true)
    }, 90_000)
    it('uses the real issue guard durable-history reader when hydration is empty or storage fails', async () => {
      for (const { failRead, failPersist, beforeTurn = false } of [
        { failRead: false, failPersist: false },
        { failRead: true, failPersist: false },
        { failRead: false, failPersist: true },
        { failRead: false, failPersist: false, beforeTurn: true },
      ]) {
        const response = await harness!.fetch('/audience-fault', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId,
            failRead,
            failPersist,
            beforeTurn,
          }),
        })
        expect(response.status, await response.clone().text()).toBe(200)
        expect(await response.json()).toEqual({
          denied: true,
          code: failRead || failPersist ? 'runtime_failed' : 'invalid_state',
          durableReads: 1,
          cacheReads: 0,
          stamps: [],
        })
      }
      expect(modelRequests).toHaveLength(0)
    })
  },
)
