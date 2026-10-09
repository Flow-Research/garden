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
import { eq, sql } from 'drizzle-orm'

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
let grantScenario:
  | {
      kind: 'issue' | 'automation'
      read: boolean
      revoke?: 'tool' | 'completion'
      retainWrite?: boolean
      neighborhood?: boolean
      handoffRevoke?: boolean
      pause?: boolean
      writebackRevoke?:
        | 'before-proposal'
        | 'during-dedupe'
        | 'before-dedupe-read'
      confidence?: number
      scope?: 'org' | 'user'
      mutation?: 'create' | 'update' | 'mention' | 'link'
      mutationRevoke?: boolean
    }
  | undefined
let brainRequests: string[] = []
let brainAuthorizationHeaders: Array<string | undefined> = []
let revokedAtBrainRequest: number | undefined
let dedupeRevocationRequest: string | undefined
const modelBrainCounts: number[] = []
let handoffCount = 0
let mutationArmed = false
let mutationBoundary: string | undefined
const seededIds: string[] = []
const modelRequests: Array<{
  messages: Array<{ role: string; content?: unknown }>
  tools?: Array<{ function: { name: string } }>
}> = []

/** Proves automatic injection independently of later explicit tool retrieval. */
function readInjection(request: (typeof modelRequests)[number]) {
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
  const ids = [...injected.matchAll(/^\d+\. \[([^\]]+)\]/gm)].map(
    (match) => match[1],
  )
  return { injected, ids }
}

function assertOrgInjection(
  request: (typeof modelRequests)[number],
  markers: string[],
) {
  const { injected, ids } = readInjection(request)
  for (const marker of markers) expect(injected).toContain(marker)
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
    let brainProxy: Server | undefined
    let harness:
      | Awaited<ReturnType<typeof startInstrumentedHarness>>
      | undefined

    beforeEach(async (context) => {
      nextIssueNumber = 2
      modelRequests.length = 0
      modelBrainCounts.length = 0
      seededIds.length = 0
      modelMode = 'issue'
      grantScenario = undefined
      handoffCount = 0
      mutationArmed = false
      mutationBoundary = undefined
      brainRequests = []
      brainAuthorizationHeaders = []
      revokedAtBrainRequest = undefined
      dedupeRevocationRequest = undefined
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
      brainProxy = createServer(async (request, response) => {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        brainRequests.push(body)
        brainAuthorizationHeaders.push(request.headers.authorization)
        const upstream = await fetch(
          `http://${helix!.getHost()}:${helix!.getMappedPort(8080)}${request.url}`,
          {
            method: request.method,
            headers: {
              'content-type': 'application/json',
              ...(request.headers.authorization
                ? { authorization: request.headers.authorization }
                : {}),
            },
            ...(body ? { body } : {}),
          },
        )
        if (
          mutationArmed &&
          grantScenario?.mutationRevoke &&
          body.includes(
            grantScenario.mutation === 'create'
              ? 'brain.ensure_indexes'
              : 'brain.read',
          )
        ) {
          mutationArmed = false
          mutationBoundary = body
          const revokedTool =
            grantScenario.mutation === 'mention'
              ? 'brain_observe_mention'
              : grantScenario.mutation === 'link'
                ? 'brain_link'
                : 'add_to_brain'
          await database!.db
            .update(schema.agent)
            .set({
              permissions: {
                full_access: false,
                allowed_tools: [
                  'brain_search',
                  'brain_neighborhood',
                  'add_to_brain',
                  'brain_observe_mention',
                  'brain_link',
                  'create_work_product',
                ].filter((tool) => tool !== revokedTool),
              },
            })
            .where(eq(schema.agent.id, agentId))
          revokedAtBrainRequest = brainRequests.length
        }
        if (
          grantScenario?.writebackRevoke === 'during-dedupe' &&
          body.includes('G08 durable')
        ) {
          dedupeRevocationRequest = body
          await database!.db
            .update(schema.agent)
            .set({
              permissions: {
                full_access: false,
                allowed_tools: ['brain_search'],
              },
            })
            .where(eq(schema.agent.id, agentId))
          grantScenario.writebackRevoke = undefined
          revokedAtBrainRequest = brainRequests.length
        }
        response.writeHead(upstream.status, {
          'content-type':
            upstream.headers.get('content-type') ?? 'application/json',
        })
        response.end(await upstream.text())
      })
      brainProxy.listen(0, '127.0.0.1')
      await once(brainProxy, 'listening')
      const brainAddress = brainProxy.address()
      if (!brainAddress || typeof brainAddress === 'string')
        throw new Error('Brain proxy not listening')
      model = createServer(async (request, response) => {
        let raw = ''
        for await (const chunk of request) raw += String(chunk)
        if (request.url?.endsWith('/handoff')) {
          handoffCount += 1
          if (grantScenario?.handoffRevoke) {
            await database!.db
              .update(schema.agent)
              .set({
                permissions: {
                  full_access: false,
                  allowed_tools: [
                    'brain_search',
                    'add_to_brain',
                    'create_work_product',
                    'complete_automation',
                  ],
                },
              })
              .where(eq(schema.agent.id, agentId))
            revokedAtBrainRequest = brainRequests.length
          }
          response.writeHead(200).end('ready')
          return
        }
        const body = JSON.parse(raw) as (typeof modelRequests)[number]
        modelRequests.push(body)
        modelBrainCounts.push(brainRequests.length)
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
        let finished =
          (writeback && toolResults.length >= 3) ||
          (modelMode === 'chat' && toolResults.length >= 1)
        let toolName =
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
        let args: Record<string, unknown> =
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
        if (grantScenario) {
          const n = toolResults.length
          if (writeback) {
            finished = n >= (grantScenario.confidence === undefined ? 3 : 2)
            toolName = n === 0 ? 'brain_search' : 'propose_brain_item'
            args =
              n === 0
                ? { query: 'G06', k: 8 }
                : {
                    claim: `G08 durable ${n === 1 ? 'review' : 'direct'} knowledge ${runId}`,
                    kind: 'policy',
                    confidence:
                      grantScenario.confidence ?? (n === 1 ? 0.5 : 0.9),
                    sensitive: false,
                    scope: grantScenario.scope ?? 'org',
                  }
            if (
              n === 1 &&
              ['before-proposal', 'before-dedupe-read'].includes(
                grantScenario.writebackRevoke ?? '',
              )
            ) {
              await database!.db
                .update(schema.agent)
                .set({
                  permissions: {
                    full_access: false,
                    allowed_tools:
                      grantScenario.writebackRevoke === 'before-dedupe-read'
                        ? ['add_to_brain']
                        : ['brain_search'],
                  },
                })
                .where(eq(schema.agent.id, agentId))
              grantScenario.writebackRevoke = undefined
              revokedAtBrainRequest = brainRequests.length
            }
          } else {
            finished = false
            const readStep = grantScenario.read && n === 0
            toolName = readStep
              ? grantScenario.neighborhood
                ? 'brain_neighborhood'
                : 'brain_search'
              : grantScenario.kind === 'automation'
                ? 'complete_automation'
                : grantScenario.pause
                  ? 'ask_question'
                  : 'create_work_product'
            args = readStep
              ? grantScenario.neighborhood
                ? { itemId: seededIds[0], depth: 1 }
                : { query: 'G06', k: 8 }
              : grantScenario.kind === 'automation'
                ? { output: JSON.stringify(observations) }
                : grantScenario.pause
                  ? { question: 'Continue G08?' }
                  : {
                      type: 'report',
                      title: 'G08 grant evidence',
                      body: JSON.stringify(observations),
                    }
            if (
              (grantScenario.revoke === 'tool' && readStep) ||
              (grantScenario.revoke === 'completion' && !readStep)
            ) {
              await database!.db
                .update(schema.agent)
                .set({
                  permissions: {
                    full_access: false,
                    allowed_tools: [
                      'create_work_product',
                      'complete_automation',
                      'ask_question',
                      ...(grantScenario.retainWrite ? ['add_to_brain'] : []),
                      ...(grantScenario.neighborhood
                        ? ['brain_search', 'add_to_brain']
                        : []),
                    ],
                  },
                })
                .where(eq(schema.agent.id, agentId))
              revokedAtBrainRequest = brainRequests.length
              grantScenario.revoke = undefined
            }
          }
        }
        if (grantScenario?.mutation && !writeback && toolResults.length === 0) {
          mutationArmed = true
          const operation = grantScenario.mutation
          toolName =
            operation === 'mention'
              ? 'brain_observe_mention'
              : operation === 'link'
                ? 'brain_link'
                : 'add_to_brain'
          args =
            operation === 'create'
              ? {
                  mode: 'create',
                  label: 'G06_MUTATION_CREATED',
                  content: 'G06_MUTATION_CREATED',
                  scope: 'org',
                }
              : operation === 'update'
                ? {
                    mode: 'update',
                    itemId: seededIds[0],
                    kind: 'note',
                    summary: 'G06_MUTATION_UPDATED',
                  }
                : operation === 'mention'
                  ? { itemId: seededIds[0], text: 'G06_MUTATION_MENTION' }
                  : {
                      from: seededIds[0],
                      to: seededIds[0],
                      edge: 'G06_MUTATION_EDGE',
                    }
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
      const persistenceFault = context.task.name.match(
        /^simulates (issue|automation) (before-turn|injection|tool) provenance persistence failure$/,
      )
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
            binding: 'BROWSER',
            service: 'garden-g06-integration',
            entrypoint: 'FixtureBrowser',
          },
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
          ...(persistenceFault
            ? {
                G08_GRANT_FAULT_KIND: persistenceFault[1]!,
                G08_GRANT_FAULT_AT: String(
                  { 'before-turn': 2, injection: 3, tool: 4 }[
                    persistenceFault[2] as 'before-turn' | 'injection' | 'tool'
                  ],
                ),
              }
            : {}),
          EXECUTOR_SECRET_KEY: 'g06-synthetic-encryption-key-only',
          HELIX_URL: `http://127.0.0.1:${brainAddress.port}`,
          ...(context.task.name.includes('configured-key grants')
            ? { HELIX_API_KEY: 'g08-synthetic-helix-key' }
            : {}),
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
      rolesByScenario[
        'closes native authority connections after repeated allowed and denied checks'
      ] = ['IssueRunSubAgent.validateBrainSummaryAccess']
      for (const kind of ['issue', 'automation'])
        rolesByScenario[
          `fails closed on ${kind} grant provenance storage faults`
        ] = []
      for (const kind of ['issue', 'automation'])
        rolesByScenario[
          `rejects absent trusted ${kind} principals at every entry boundary`
        ] = []
      for (const kind of ['issue', 'automation'])
        for (const phase of ['before-turn', 'injection', 'tool'])
          rolesByScenario[
            `simulates ${kind} ${phase} provenance persistence failure`
          ] = [
            `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
            ...(phase === 'tool'
              ? ['BrainWriteBackSubAgent.runWriteBack']
              : []),
          ]
      for (const form of ['legacy', 'uuid'])
        rolesByScenario[
          `resolves ${form} runtime aliases without accepting missing principals`
        ] = [
          'IssueRunSubAgent.completeWorkflowTurn',
          'BrainWriteBackSubAgent.runWriteBack',
        ]
      for (const operation of ['create', 'update', 'mention', 'link'])
        for (const revoked of [false, true])
          rolesByScenario[
            `rechecks ${operation} grant after native preflight revoked=${revoked}`
          ] = [
            'IssueRunSubAgent.completeWorkflowTurn',
            ...(revoked ? [] : ['BrainWriteBackSubAgent.runWriteBack']),
          ]
      for (const kind of ['issue', 'automation']) {
        for (const policy of [
          'denied',
          'read-only',
          'allowed',
          'revoked-tool',
          'revoked-completion',
          'revoked-read-only',
          'default',
          'empty-list',
          'configured-key',
          'write-only',
        ]) {
          rolesByScenario[
            `enforces ${policy} grants in real ${kind} workflow`
          ] = [
            `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
            ...(policy.startsWith('revoked')
              ? []
              : ['BrainWriteBackSubAgent.runWriteBack']),
          ]
        }
      }
      rolesByScenario[
        'rejects mismatched or missing authoritative writeback origins and invalid policies'
      ] = ['BrainWriteBackSubAgent.runWriteBack']
      rolesByScenario[
        'rejects issue RPC run and principal substitution without ledger mutations'
      ] = [
        'IssueRunSubAgent.executeWorkflowTurn',
        'IssueRunSubAgent.completeWorkflowTurn',
        'BrainWriteBackSubAgent.runWriteBack',
      ]
      for (const kind of ['issue', 'automation']) {
        for (const state of kind === 'automation'
          ? ['revoked', 'always-denied', 'owner-changed']
          : ['revoked', 'always-denied'])
          rolesByScenario[
            `protects ${state} retained ${kind} history on resume`
          ] = [
            `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.executeWorkflowTurn`,
            `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
            ...(state === 'always-denied' || kind === 'automation'
              ? ['BrainWriteBackSubAgent.runWriteBack']
              : []),
          ]
        for (const phase of ['before-proposal', 'during-dedupe'])
          for (const confidence of [0.5, 0.9])
            rolesByScenario[
              `revokes ${kind} writeback ${phase} at confidence ${confidence}`
            ] = [
              `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
              'BrainWriteBackSubAgent.runWriteBack',
            ]
      }
      for (const kind of ['issue', 'automation'])
        for (const revoked of [false, true])
          rolesByScenario[
            `protects neighborhood-only ${kind} completion revoked=${revoked}`
          ] = [
            `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
            ...(revoked ? [] : ['BrainWriteBackSubAgent.runWriteBack']),
          ]
      for (const label of [
        'issue-owner',
        'issue-org',
        'automation-owner',
        'automation-other',
        'automation-foreign',
        'private-proposal-oracle',
        'issue-override',
      ])
        rolesByScenario[`checks native dedupe and policy ${label}`] = [
          'BrainWriteBackSubAgent.runWriteBack',
        ]
      for (const kind of ['issue', 'automation'])
        for (const revoked of [false, true])
          rolesByScenario[
            `revalidates ${kind} summary handoff revoked=${revoked}`
          ] = [
            `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
            'BrainWriteBackSubAgent.runWriteBack',
          ]
      for (const kind of ['issue', 'automation'])
        rolesByScenario[
          `denies ${kind} proposal dedupe after read-only revocation`
        ] = [
          `${kind === 'issue' ? 'Issue' : 'Automation'}RunSubAgent.completeWorkflowTurn`,
          'BrainWriteBackSubAgent.runWriteBack',
        ]
      for (const [scenario, roles] of Object.entries(rolesByScenario)) {
        if (
          scenario.startsWith('revalidates ') ||
          scenario.startsWith('checks native dedupe') ||
          /^enforces (allowed|default|empty-list|configured-key) grants/.test(
            scenario,
          )
        ) {
          const kind = scenario.includes('automation') ? 'Automation' : 'Issue'
          roles.push(`${kind}RunSubAgent.validateBrainSummaryAccess`)
        }
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
      if (context.task.result?.state === 'fail') {
        harness?.debug()
        console.info('G08 scenario failure', context.task.result.errors)
      }
    })

    afterEach(async (context) => {
      if (context.task.result?.state === 'fail') {
        harness?.debug()
        console.info('G08 scenario failure', context.task.result.errors)
      }
      const workerCleanup = await Promise.allSettled([harness?.close()])
      const cleanup = await Promise.allSettled([
        new Promise<void>((resolve, reject) =>
          model
            ? model.close((error) => (error ? reject(error) : resolve()))
            : resolve(),
        ),
        new Promise<void>((resolve, reject) =>
          brainProxy
            ? brainProxy.close((error) => (error ? reject(error) : resolve()))
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

    async function seedAutomation() {
      const automationId = crypto.randomUUID()
      const automationRunId = crypto.randomUUID()
      await database!.db.insert(schema.automation).values({
        id: automationId,
        workspaceId,
        title: 'G08 automation',
        createdBy: ownerId,
        assigneeAgentId: agentId,
        systemPrompt: 'Report G06 knowledge.',
        executionConfig: {},
      })
      await database!.db.insert(schema.automationRun).values({
        id: automationRunId,
        workspaceId,
        automationId,
        agentId,
        hostName: agentId,
        source: 'manual',
        status: 'queued',
        workflowInstanceId: automationRunId,
      })
      return { agentId, runId: automationRunId }
    }

    for (const kind of ['issue', 'automation'] as const) {
      for (const policy of [
        'denied',
        'read-only',
        'allowed',
        'revoked-tool',
        'revoked-completion',
        'revoked-read-only',
        'default',
        'empty-list',
        'configured-key',
        'write-only',
      ] as const) {
        it(`enforces ${policy} grants in real ${kind} workflow`, async () => {
          const read = policy !== 'denied' && policy !== 'write-only'
          const mayWrite = [
            'allowed',
            'default',
            'empty-list',
            'configured-key',
          ].includes(policy)
          grantScenario = {
            kind,
            read,
            ...(policy === 'revoked-tool'
              ? { revoke: 'tool' as const }
              : policy === 'revoked-completion' ||
                  policy === 'revoked-read-only'
                ? {
                    revoke: 'completion' as const,
                    retainWrite: policy === 'revoked-read-only',
                  }
                : {}),
          }
          await database!.db
            .update(schema.agent)
            .set({
              permissions:
                policy === 'default'
                  ? {}
                  : policy === 'empty-list'
                    ? { full_access: false, allowed_tools: [] }
                    : policy === 'allowed' ||
                        policy === 'configured-key' ||
                        policy.startsWith('revoked')
                      ? { full_access: true }
                      : {
                          full_access: false,
                          allowed_tools: [
                            'create_work_product',
                            'complete_automation',
                            'ask_question',
                            ...(read ? ['brain_search'] : []),
                            ...(policy === 'write-only'
                              ? ['add_to_brain']
                              : []),
                          ],
                        },
            })
            .where(eq(schema.agent.id, agentId))
          const input =
            kind === 'issue'
              ? await seedIssue('G08 grant matrix')
              : await seedAutomation()
          const baselineReads = brainRequests.length
          const response = await harness!.fetch(
            kind === 'issue' ? '/start' : '/automation-start',
            { method: 'POST', body: JSON.stringify(input) },
          )
          expect(response.status, await response.clone().text()).toBe(200)
          await expect
            .poll(
              async () => {
                const table =
                  kind === 'issue' ? schema.issueRun : schema.automationRun
                const [row] = await database!.db
                  .select({ status: table.status })
                  .from(table)
                  .where(eq(table.id, input.runId))
                return row?.status
              },
              { timeout: 60_000 },
            )
            .toMatch(/^(succeeded|completed|failed|cancelled|blocked)$/)
          const resultTable =
            kind === 'issue' ? schema.issueRun : schema.automationRun
          const [result] = await database!.db
            .select({ status: resultTable.status, error: resultTable.error })
            .from(resultTable)
            .where(eq(resultTable.id, input.runId))
          expect(result?.status, result?.error ?? 'Missing run').toBe(
            kind === 'issue' ? 'succeeded' : 'completed',
          )
          if (!read) expect(brainRequests.length).toBe(baselineReads)
          if (policy.startsWith('revoked'))
            await expect
              .poll(() => JSON.stringify(harness!.getLogs()), {
                timeout: 60_000,
              })
              .toContain('agent_runtime.brain_summary_denied')
          else
            await expect
              .poll(() => JSON.stringify(harness!.getLogs()), {
                timeout: 60_000,
              })
              .toMatch(
                new RegExp(
                  `agent_do\\.brain_write_back\\.(?:completed|trigger_failed)[^\n]*${input.runId}`,
                ),
              )
          const writebackCalls = modelRequests.filter((request) =>
            request.tools?.some(
              (tool) => tool.function.name === 'propose_brain_item',
            ),
          )
          const proposals = await database!.db
            .select()
            .from(schema.brainWriteProposal)
          if (policy.startsWith('revoked')) {
            expect(revokedAtBrainRequest).toBeTypeOf('number')
            expect(brainRequests.length).toBe(revokedAtBrainRequest)
            if (policy === 'revoked-tool')
              expect(JSON.stringify(modelRequests)).toContain(
                'No active run context',
              )
          }
          if (!read) {
            expect(brainRequests.length).toBe(baselineReads)
            expect(JSON.stringify(modelRequests)).not.toContain(allowedMarker)
          } else {
            expect(JSON.stringify(modelRequests[0])).toContain(
              'Org Brain memory for this turn.',
            )
            expect(JSON.stringify(modelRequests[0])).toContain(allowedMarker)
          }
          if (mayWrite) {
            expect(writebackCalls.length).toBeGreaterThan(0)
            expect(proposals).toHaveLength(1)
            expect(proposals[0]!.claim).toContain('G08 durable review')
          } else {
            expect(writebackCalls).toHaveLength(0)
            expect(proposals).toHaveLength(0)
          }
          expect(JSON.stringify(harness!.getLogs())).not.toContain(
            'G08_UNEXPECTED_BROWSER_CALL',
          )
          // This fixture proves credential propagation, not Helix authentication enforcement.
          if (policy === 'configured-key') {
            const observed = brainAuthorizationHeaders.slice(baselineReads)
            expect(observed.length).toBeGreaterThan(0)
            expect(
              observed.every(
                (value) => value === 'Bearer g08-synthetic-helix-key',
              ),
            ).toBe(true)
          }
          const snapshot = await harness!.fetch('/snapshot', {
            method: 'POST',
            body: JSON.stringify({ workspaceId }),
          })
          expect(snapshot.status).toBe(200)
          const persisted = await snapshot.text()
          if (mayWrite) expect(persisted).toContain('G08 durable direct')
          else expect(persisted).not.toContain('G08 durable')
        }, 90_000)
      }
    }

    for (const kind of ['issue', 'automation'] as const)
      for (const revoked of [false, true]) {
        it(`protects neighborhood-only ${kind} completion revoked=${revoked}`, async () => {
          grantScenario = {
            kind,
            read: true,
            neighborhood: true,
            ...(revoked ? { revoke: 'completion' as const } : {}),
          }
          await database!.db
            .update(schema.agent)
            .set({
              permissions: {
                full_access: false,
                allowed_tools: [
                  'brain_neighborhood',
                  'add_to_brain',
                  'create_work_product',
                  'complete_automation',
                ],
              },
            })
            .where(eq(schema.agent.id, agentId))
          const input =
            kind === 'issue'
              ? await seedIssue('G08 neighborhood')
              : await seedAutomation()
          expect(
            (
              await harness!.fetch(
                kind === 'issue' ? '/start' : '/automation-start',
                { method: 'POST', body: JSON.stringify(input) },
              )
            ).status,
          ).toBe(200)
          await expect
            .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60_000 })
            .toContain(
              revoked
                ? 'agent_runtime.brain_summary_denied'
                : 'agent_do.brain_write_back.trigger_failed',
            )
          expect(JSON.stringify(modelRequests[0])).not.toContain(allowedMarker)
          expect(JSON.stringify(modelRequests.slice(1))).toContain(
            allowedMarker,
          )
          expect(
            modelRequests.filter((request) =>
              request.tools?.some(
                (tool) => tool.function.name === 'propose_brain_item',
              ),
            ),
          ).toHaveLength(0)
          const table =
            kind === 'issue' ? schema.issueRun : schema.automationRun
          expect(
            (
              await database!.db
                .select({ status: table.status })
                .from(table)
                .where(eq(table.id, input.runId))
            )[0]?.status,
          ).toBe(kind === 'issue' ? 'succeeded' : 'completed')
          expect(
            await database!.db.select().from(schema.brainWriteProposal),
          ).toHaveLength(0)
          if (revoked) expect(brainRequests.length).toBe(revokedAtBrainRequest)
        }, 90_000)
      }

    for (const kind of ['issue', 'automation'] as const)
      for (const revoked of [false, true]) {
        it(`revalidates ${kind} summary handoff revoked=${revoked}`, async () => {
          grantScenario = {
            kind,
            read: true,
            neighborhood: true,
            handoffRevoke: revoked,
          }
          const input =
            kind === 'issue'
              ? await seedIssue('G08 handoff')
              : await seedAutomation()
          expect(
            (
              await harness!.fetch(
                kind === 'issue' ? '/start' : '/automation-start',
                { method: 'POST', body: JSON.stringify(input) },
              )
            ).status,
          ).toBe(200)
          await expect
            .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60_000 })
            .toMatch(/agent_do\.brain_write_back\.(completed|trigger_failed)/)
          expect(handoffCount).toBe(1)
          const neighborhoodResults = modelRequests
            .filter(
              (request) =>
                !request.tools?.some(
                  (tool) => tool.function.name === 'propose_brain_item',
                ),
            )
            .flatMap((request) => request.messages)
            .filter((message) => message.role === 'tool')
            .map(
              (message) =>
                JSON.parse(String(message.content)) as {
                  ok?: boolean
                  items?: Array<{ id: string }>
                },
            )
            .filter((result) => result.items !== undefined)
          expect(neighborhoodResults).toContainEqual(
            expect.objectContaining({
              ok: true,
              items: expect.arrayContaining([
                expect.objectContaining({ id: seededIds[0] }),
              ]),
            }),
          )
          expect(JSON.stringify(neighborhoodResults)).toContain(allowedMarker)
          expect(JSON.stringify(modelRequests)).toContain(allowedMarker)
          const calls = modelRequests.filter((request) =>
            request.tools?.some(
              (tool) => tool.function.name === 'propose_brain_item',
            ),
          )
          if (revoked) {
            expect(
              calls,
              'a new writeback model must not receive a summary after its originating neighborhood grant is revoked',
            ).toHaveLength(0)
            expect(brainRequests.length).toBe(revokedAtBrainRequest)
            expect(
              await database!.db.select().from(schema.brainWriteProposal),
            ).toHaveLength(0)
          } else {
            expect(calls.length).toBeGreaterThan(0)
            expect(
              await database!.db.select().from(schema.brainWriteProposal),
            ).toHaveLength(1)
          }
          const table =
            kind === 'issue' ? schema.issueRun : schema.automationRun
          expect(
            (
              await database!.db
                .select({ status: table.status })
                .from(table)
                .where(eq(table.id, input.runId))
            )[0]?.status,
          ).toBe(kind === 'issue' ? 'succeeded' : 'completed')
        }, 90_000)
      }

    for (const label of [
      'issue-owner',
      'issue-org',
      'automation-owner',
      'automation-other',
      'automation-foreign',
      'private-proposal-oracle',
      'issue-override',
    ] as const) {
      it(`checks native dedupe and policy ${label}`, async () => {
        const kind = label.startsWith('automation') ? 'automation' : 'issue'
        grantScenario = { kind, read: false, confidence: 0.5, scope: 'user' }
        const input =
          kind === 'issue'
            ? await seedIssue('G08 dedupe')
            : await seedAutomation()
        const claim = `G08 durable review knowledge ${runId}`
        const base = {
          ...input,
          claimedAgentId: agentId,
          runKind: kind,
          originObjectId:
            'issueId' in input ? String(input.issueId) : input.runId,
          workspaceId,
          ownerUserId: ownerId,
        }
        if (!['private-proposal-oracle', 'issue-override'].includes(label)) {
          const seed = await harness!.fetch('/seed', {
            method: 'POST',
            body: JSON.stringify({
              workspaceId:
                label === 'automation-foreign'
                  ? foreignWorkspaceId
                  : workspaceId,
              label: claim,
              scope:
                label === 'issue-org'
                  ? { kind: 'org' }
                  : {
                      kind: 'user',
                      userId:
                        label === 'automation-other' ? initiatorId : ownerId,
                    },
            }),
          })
          expect(seed.status).toBe(200)
        }
        if (label === 'issue-override') {
          await database!.db
            .update(schema.issue)
            .set({
              permissionsOverride: {
                full_access: false,
                allowed_tools: ['post_comment'],
              },
            })
            .where(eq(schema.issue.id, base.originObjectId))
          const denied = await harness!.fetch('/writeback-origin', {
            method: 'POST',
            body: JSON.stringify({ ...base, expectOriginValidation: false }),
          })
          expect(await denied.json()).toMatchObject({ ok: false })
          expect(modelRequests).toHaveLength(0)
          await database!.db
            .update(schema.agent)
            .set({
              permissions: {
                full_access: false,
                allowed_tools: ['post_comment'],
              },
            })
            .where(eq(schema.agent.id, agentId))
          await database!.db
            .update(schema.issue)
            .set({ permissionsOverride: { full_access: true } })
            .where(eq(schema.issue.id, base.originObjectId))
        }
        const response = await harness!.fetch('/writeback-origin', {
          method: 'POST',
          body: JSON.stringify(base),
        })
        expect(await response.json()).toMatchObject({ ok: true })
        const toolResults = modelRequests
          .flatMap((request) => request.messages)
          .filter((message) => message.role === 'tool')
          .map(
            (message) =>
              JSON.parse(String(message.content)) as Record<string, unknown>,
          )
        const duplicate = label === 'issue-org' || label === 'automation-owner'
        expect(toolResults).toContainEqual(
          duplicate
            ? { ok: true, action: 'skipped', reason: 'duplicate' }
            : kind === 'issue'
              ? { ok: true, action: 'submitted' }
              : expect.objectContaining({ ok: true, action: 'proposed' }),
        )
        const rows = await database!.db.select().from(schema.brainWriteProposal)
        expect(rows).toHaveLength(duplicate ? 0 : 1)
        if (label === 'private-proposal-oracle') {
          const before = modelRequests.length
          const repeated = await harness!.fetch('/writeback-origin', {
            method: 'POST',
            body: JSON.stringify(base),
          })
          expect(await repeated.json()).toMatchObject({ ok: true })
          const secondResults = modelRequests
            .slice(before)
            .flatMap((request) => request.messages)
            .filter((message) => message.role === 'tool')
            .map((message) => JSON.parse(String(message.content)))
          expect(secondResults).toContainEqual({
            ok: true,
            action: 'submitted',
          })
          expect(JSON.stringify(secondResults)).not.toContain('duplicate')
          expect(JSON.stringify(secondResults)).not.toContain(rows[0]!.id)
          expect(
            await database!.db.select().from(schema.brainWriteProposal),
          ).toEqual(rows)
          const thirdStart = modelRequests.length
          const another = await seedIssue('G08 cross-run private duplicate')
          const crossRun = await harness!.fetch('/writeback-origin', {
            method: 'POST',
            body: JSON.stringify({
              ...base,
              ...another,
              originObjectId: another.issueId,
            }),
          })
          expect(await crossRun.json()).toMatchObject({ ok: true })
          const thirdResults = modelRequests
            .slice(thirdStart)
            .flatMap((request) => request.messages)
            .filter((message) => message.role === 'tool')
            .map((message) => JSON.parse(String(message.content)))
          expect(thirdResults).toContainEqual({ ok: true, action: 'submitted' })
          expect(JSON.stringify(thirdResults)).not.toContain('duplicate')
          expect(JSON.stringify(thirdResults)).not.toContain(rows[0]!.id)
          expect(
            await database!.db.select().from(schema.brainWriteProposal),
          ).toEqual(rows)
        }
      }, 90_000)
    }

    it('rejects mismatched or missing authoritative writeback origins and invalid policies', async () => {
      const initialReads = brainRequests.length
      const base = {
        agentId,
        claimedAgentId: agentId,
        runKind: 'issue',
        runId,
        originObjectId: issueId,
        workspaceId,
        ownerUserId: ownerId,
      }
      for (const changes of [
        { runId: crypto.randomUUID() },
        { originObjectId: crypto.randomUUID() },
        { workspaceId: foreignWorkspaceId },
        { ownerUserId: initiatorId },
        { claimedAgentId: crypto.randomUUID() },
        { runKind: 'automation' },
      ]) {
        const response = await harness!.fetch('/writeback-origin', {
          method: 'POST',
          body: JSON.stringify({ ...base, ...changes }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ ok: false })
      }
      const automation = await seedAutomation()
      const missingAutomation = await harness!.fetch('/writeback-origin', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          runKind: 'automation',
          runId: automation.runId,
          originObjectId: crypto.randomUUID(),
        }),
      })
      expect(await missingAutomation.json()).toMatchObject({ ok: false })
      for (const permissions of [null, { full_access: 'yes' }]) {
        await database!.db
          .update(schema.agent)
          .set({ permissions })
          .where(eq(schema.agent.id, agentId))
        const response = await harness!.fetch('/writeback-origin', {
          method: 'POST',
          body: JSON.stringify(base),
        })
        expect(await response.json()).toMatchObject({ ok: false })
      }
      expect(modelRequests).toHaveLength(0)
      expect(brainRequests.length).toBe(initialReads)
      expect(
        await database!.db.select().from(schema.brainWriteProposal),
      ).toHaveLength(0)
    }, 90_000)

    for (const kind of ['issue', 'automation'] as const)
      for (const phase of ['before-turn', 'injection', 'tool'] as const)
        it(`simulates ${kind} ${phase} provenance persistence failure`, async () => {
          grantScenario = { kind, read: true }
          const input =
            kind === 'issue'
              ? await seedIssue('G08 storage failure simulation')
              : await seedAutomation()
          const before = brainRequests.length
          expect(
            (
              await harness!.fetch(
                kind === 'issue' ? '/start' : '/automation-start',
                { method: 'POST', body: JSON.stringify(input) },
              )
            ).status,
          ).toBe(200)
          const table =
            kind === 'issue' ? schema.issueRun : schema.automationRun
          await expect
            .poll(
              async () =>
                (
                  await database!.db
                    .select({ status: table.status })
                    .from(table)
                    .where(eq(table.id, input.runId))
                )[0]?.status,
              { timeout: 60000 },
            )
            .toBe(
              phase === 'tool'
                ? kind === 'issue'
                  ? 'succeeded'
                  : 'completed'
                : 'failed',
            )
          const logs = JSON.stringify(harness!.getLogs())
          const ordinal = { 'before-turn': 2, injection: 3, tool: 4 }[phase]
          expect(logs).toContain('G08_CONFIG_PERSISTED')
          expect(logs).toContain('G08_CONFIG_FAULT')
          const faults = harness!
            .getLogs()
            .filter((log) => String(log.message).startsWith('G08_CONFIG_FAULT'))
          expect(faults).toHaveLength(1)
          expect(
            JSON.parse(
              String(faults[0]!.message)
                .slice('G08_CONFIG_FAULT'.length)
                .trim(),
            ),
          ).toEqual({
            kind,
            ordinal,
            provenance: {
              identity: `${kind}:${workspaceId}:${agentId}:${ownerId}`,
              tools: phase === 'before-turn' ? [] : ['brain_search'],
            },
          })
          const persisted = harness!
            .getLogs()
            .filter((log) =>
              String(log.message).startsWith('G08_CONFIG_PERSISTED'),
            )
            .map((log) =>
              JSON.parse(
                String(log.message).slice('G08_CONFIG_PERSISTED'.length).trim(),
              ),
            )
          expect(persisted).toContainEqual({
            kind,
            ordinal: 1,
            provenance: {
              identity: `${kind}:${workspaceId}:${agentId}:${ownerId}`,
              tools: [],
            },
          })
          if (phase === 'tool') {
            if (kind === 'issue') {
              assertOrgInjection(modelRequests[0]!, [allowedMarker])
            } else {
              const { injected, ids } = readInjection(modelRequests[0]!)
              expect(injected).toContain(allowedMarker)
              expect(injected).toContain(deniedMarkers[0])
              for (const marker of deniedMarkers.slice(1))
                expect(injected).not.toContain(marker)
              for (const id of seededIds.slice(0, 2)) expect(ids).toContain(id)
              for (const id of seededIds.slice(2)) expect(ids).not.toContain(id)
            }
            const result = modelRequests[1]!.messages
              .filter((m) => m.role === 'tool')
              .map((m) => JSON.parse(String(m.content)))
            expect(result).toContainEqual({
              ok: false,
              error:
                'No active run context; the brain tools need a workspace and agent.',
            })
            expect(modelBrainCounts[1]).toBe(modelBrainCounts[0])
            await expect
              .poll(() => JSON.stringify(harness!.getLogs()), {
                timeout: 60000,
              })
              .toContain('agent_do.brain_write_back.completed')
          } else {
            expect(modelRequests).toHaveLength(0)
            expect(brainRequests.length).toBe(before)
            expect(
              await database!.db.select().from(schema.brainWriteProposal),
            ).toHaveLength(0)
          }
        }, 90000)

    for (const form of ['legacy', 'uuid'] as const)
      it(`resolves ${form} runtime aliases without accepting missing principals`, async () => {
        const alias =
          form === 'legacy' ? 'legacy-runtime-host' : crypto.randomUUID()
        const phase = (name: string) =>
          console.info(
            'G08_ALIAS_PHASE',
            JSON.stringify({ form, name, time: Date.now() }),
          )
        phase('node-update-start')
        await database!.db
          .update(schema.agent)
          .set({ hostName: alias })
          .where(eq(schema.agent.id, agentId))
        phase('node-update-end')
        phase('binding-request-start')
        const denied = await harness!.fetch('/binding-fault', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'issue',
            agentId: 'missing-runtime-host',
            objectId: issueId,
            runId,
            method: 'validateBrainSummaryAccess',
            missingParent: false,
          }),
        })
        phase('binding-response-headers')
        const deniedBody = await denied.json()
        phase('binding-response-body')
        console.info(
          'G08_ALIAS_WORKER_PHASES',
          JSON.stringify(
            harness!
              .getLogs()
              .filter((log) =>
                String(log.message).includes('G08_BINDING_PHASE'),
              ),
          ),
        )
        expect(deniedBody).toMatchObject({
          denied: true,
          message: expect.stringContaining(
            'Brain runtime principal is missing or ambiguous.',
          ),
        })
        expect(modelRequests).toHaveLength(0)
        grantScenario = { kind: 'issue', read: true }
        phase('start-request-begin')
        const started = await harness!.fetch('/start', {
          method: 'POST',
          body: JSON.stringify({ agentId: alias, issueId, runId }),
        })
        phase('start-request-end')
        expect(started.status).toBe(200)
        phase('writeback-wait-begin')
        await expect
          .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60000 })
          .toContain('agent_do.brain_write_back.completed')
        phase('writeback-wait-end')
        phase('ledger-read-begin')
        expect(
          (
            await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, runId))
          )[0]?.status,
        ).toBe('succeeded')
        assertOrgInjection(modelRequests[0]!, [allowedMarker])
        expect(
          await database!.db
            .select()
            .from(schema.issueWorkProduct)
            .where(eq(schema.issueWorkProduct.runId, runId)),
        ).toHaveLength(1)
        phase('ledger-read-end')
      }, 90000)

    it('rejects issue RPC run and principal substitution without ledger mutations', async () => {
      const otherIssue = await seedIssue('Other issue')
      const otherAgent = crypto.randomUUID()
      await database!.db
        .update(schema.agent)
        .set({ hostName: 'original-host' })
        .where(eq(schema.agent.id, agentId))
      await database!.db.insert(schema.agent).values({
        id: otherAgent,
        workspaceId,
        ownerUserId: ownerId,
        name: 'Other principal',
        hostName: agentId,
        permissions: { full_access: true },
      })
      const otherRun = crypto.randomUUID()
      await database!.db.insert(schema.issueRun).values({
        id: otherRun,
        workspaceId,
        issueId,
        agentId: otherAgent,
        hostName: agentId,
      })
      const initialReads = brainRequests.length
      for (const target of [otherIssue.runId, otherRun, crypto.randomUUID()]) {
        const response = await harness!.fetch('/issue-turn', {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            issueId,
            runId: target,
            mode: 'start',
            turn: 0,
            expectCompletion: false,
          }),
        })
        expect(await response.json()).toMatchObject({ ok: false })
      }
      const rows = await database!.db.select().from(schema.issueRun)
      expect(
        rows
          .map((row) => ({ id: row.id, status: row.status }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(
        [runId, otherIssue.runId, otherRun]
          .sort()
          .map((id) => ({ id, status: 'queued' })),
      )
      expect(modelRequests).toHaveLength(0)
      expect(brainRequests.length).toBe(initialReads)
      grantScenario = { kind: 'issue', read: false }
      const positive = await harness!.fetch('/start', {
        method: 'POST',
        body: JSON.stringify({ agentId, issueId, runId }),
      })
      expect(positive.status).toBe(200)
      await expect
        .poll(
          async () =>
            (
              await database!.db
                .select()
                .from(schema.issueRun)
                .where(eq(schema.issueRun.id, runId))
            )[0]?.status,
          { timeout: 60000 },
        )
        .toBe('succeeded')
      await expect
        .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60000 })
        .toContain('agent_do.brain_write_back.completed')
      expect(
        await database!.db
          .select()
          .from(schema.issueWorkProduct)
          .where(eq(schema.issueWorkProduct.runId, runId)),
      ).toHaveLength(1)
      for (const untouched of [otherIssue.runId, otherRun])
        expect(
          (
            await database!.db
              .select()
              .from(schema.issueRun)
              .where(eq(schema.issueRun.id, untouched))
          )[0]?.status,
        ).toBe('queued')
    }, 90_000)

    for (const kind of ['issue', 'automation'] as const)
      for (const state of kind === 'automation'
        ? (['revoked', 'always-denied', 'owner-changed'] as const)
        : (['revoked', 'always-denied'] as const)) {
        it(`protects ${state} retained ${kind} history on resume`, async () => {
          const read = state !== 'always-denied'
          const nonBrainTools = [
            'create_work_product',
            'complete_automation',
            'ask_question',
          ]
          grantScenario = { kind, read, pause: kind === 'issue' }
          await database!.db
            .update(schema.agent)
            .set({
              permissions: {
                full_access: false,
                allowed_tools: [
                  ...nonBrainTools,
                  ...(read ? ['brain_search'] : []),
                ],
              },
            })
            .where(eq(schema.agent.id, agentId))
          const input =
            kind === 'issue'
              ? await seedIssue('G08 resume')
              : await seedAutomation()
          expect(
            (
              await harness!.fetch(
                kind === 'issue' ? '/start' : '/automation-start',
                { method: 'POST', body: JSON.stringify(input) },
              )
            ).status,
          ).toBe(200)
          const table =
            kind === 'issue' ? schema.issueRun : schema.automationRun
          await expect
            .poll(
              async () =>
                (
                  await database!.db
                    .select({ status: table.status })
                    .from(table)
                    .where(eq(table.id, input.runId))
                )[0]?.status,
              { timeout: 60_000 },
            )
            .toBe(kind === 'issue' ? 'waiting_for_input' : 'completed')
          if (kind === 'automation') {
            await expect
              .poll(() => JSON.stringify(harness!.getLogs()), {
                timeout: 60_000,
              })
              .toContain('agent_do.brain_write_back.trigger_failed')
            // The product has no automation wait state. Exercise its actual resume
            // RPC against a persisted running ledger, without claiming Workflow wait.
            await database!.db
              .update(schema.automationRun)
              .set({ status: 'running', completedAt: null })
              .where(eq(schema.automationRun.id, input.runId))
          }
          if (read)
            expect(JSON.stringify(modelRequests)).toContain(allowedMarker)
          else
            expect(JSON.stringify(modelRequests)).not.toContain(allowedMarker)
          if (state === 'owner-changed')
            expect(JSON.stringify(modelRequests)).toContain(deniedMarkers[0])
          await database!.db
            .update(schema.agent)
            .set(
              state === 'owner-changed'
                ? {
                    ownerUserId: initiatorId,
                    permissions: { full_access: true },
                  }
                : {
                    permissions: {
                      full_access: false,
                      allowed_tools: nonBrainTools,
                    },
                  },
            )
            .where(eq(schema.agent.id, agentId))
          grantScenario.pause = false
          grantScenario.read = false
          const beforeModel = modelRequests.length
          const beforeBrain = brainRequests.length
          const response = await harness!.fetch(
            kind === 'issue' ? '/resume' : '/automation-turn',
            {
              method: 'POST',
              body: JSON.stringify({
                ...input,
                mode: 'resume',
                turn: 1,
                expectCompletion: kind === 'issue' && state === 'always-denied',
              }),
            },
          )
          expect(response.status).toBe(200)
          if (kind === 'automation' && state !== 'always-denied')
            expect(await response.json()).toMatchObject({ ok: false })
          await expect
            .poll(
              async () =>
                (
                  await database!.db
                    .select({ status: table.status })
                    .from(table)
                    .where(eq(table.id, input.runId))
                )[0]?.status,
              { timeout: 60_000 },
            )
            .toBe(
              state !== 'always-denied'
                ? 'failed'
                : kind === 'issue'
                  ? 'succeeded'
                  : 'completed',
            )
          if (state !== 'always-denied')
            expect(modelRequests.length).toBe(beforeModel)
          else expect(modelRequests.length).toBeGreaterThan(beforeModel)
          expect(brainRequests.length).toBe(beforeBrain)
          expect(
            await database!.db.select().from(schema.brainWriteProposal),
          ).toHaveLength(0)
        }, 90_000)
      }

    for (const kind of ['issue', 'automation'] as const)
      for (const phase of ['before-proposal', 'during-dedupe'] as const)
        for (const confidence of [0.5, 0.9]) {
          it(`revokes ${kind} writeback ${phase} at confidence ${confidence}`, async () => {
            grantScenario = {
              kind,
              read: true,
              writebackRevoke: phase,
              confidence,
            }
            const input =
              kind === 'issue'
                ? await seedIssue('G08 writeback revoke')
                : await seedAutomation()
            expect(
              (
                await harness!.fetch(
                  kind === 'issue' ? '/start' : '/automation-start',
                  { method: 'POST', body: JSON.stringify(input) },
                )
              ).status,
            ).toBe(200)
            await expect
              .poll(() => JSON.stringify(harness!.getLogs()), {
                timeout: 60_000,
              })
              .toMatch(
                new RegExp(
                  `agent_do\\.brain_write_back\\.completed[^\n]*${input.runId}`,
                ),
              )
            expect(revokedAtBrainRequest).toBeTypeOf('number')
            expect(
              await database!.db.select().from(schema.brainWriteProposal),
            ).toHaveLength(0)
            const writebackCalls = modelRequests.filter((request) =>
              request.tools?.some(
                (tool) => tool.function.name === 'propose_brain_item',
              ),
            )
            expect(writebackCalls.length).toBeGreaterThan(1)
            expect(JSON.stringify(writebackCalls)).toContain(
              phase === 'before-proposal'
                ? 'No active run context.'
                : 'Brain write is not permitted.',
            )
            if (phase === 'during-dedupe')
              expect(dedupeRevocationRequest).toContain('G08 durable')
            const snapshot = await harness!.fetch('/snapshot', {
              method: 'POST',
              body: JSON.stringify({ workspaceId }),
            })
            expect(await snapshot.text()).not.toContain('G08 durable')
          }, 90_000)
        }

    for (const kind of ['issue', 'automation'] as const)
      it(`denies ${kind} proposal dedupe after read-only revocation`, async () => {
        grantScenario = {
          kind,
          read: true,
          writebackRevoke: 'before-dedupe-read',
          confidence: 0.5,
        }
        const input =
          kind === 'issue'
            ? await seedIssue('G08 dedupe read revoke')
            : await seedAutomation()
        expect(
          (
            await harness!.fetch(
              kind === 'issue' ? '/start' : '/automation-start',
              { method: 'POST', body: JSON.stringify(input) },
            )
          ).status,
        ).toBe(200)
        await expect
          .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60000 })
          .toContain('agent_do.brain_write_back.completed')
        expect(revokedAtBrainRequest).toBeTypeOf('number')
        expect(brainRequests.length).toBe(revokedAtBrainRequest)
        const calls = modelRequests.filter((r) =>
          r.tools?.some((t) => t.function.name === 'propose_brain_item'),
        )
        expect(calls.length).toBeGreaterThan(1)
        expect(JSON.stringify(calls)).toContain('Brain read is not permitted.')
        expect(
          await database!.db.select().from(schema.brainWriteProposal),
        ).toHaveLength(0)
      }, 90000)

    for (const operation of ['create', 'update', 'mention', 'link'] as const)
      for (const revoked of [false, true])
        it(`rechecks ${operation} grant after native preflight revoked=${revoked}`, async () => {
          grantScenario = {
            kind: 'issue',
            read: true,
            mutation: operation,
            mutationRevoke: revoked,
          }
          const inspect = async () => {
            const response = await harness!.fetch('/inspect', {
              method: 'POST',
              body: JSON.stringify({
                workspaceId,
                itemId: seededIds[0],
                userId: ownerId,
              }),
            })
            expect(response.status).toBe(200)
            return await response.json()
          }
          const before = await inspect()
          const input = await seedIssue('G08 mutation boundary')
          expect(
            (
              await harness!.fetch('/start', {
                method: 'POST',
                body: JSON.stringify(input),
              })
            ).status,
          ).toBe(200)
          await expect
            .poll(
              async () =>
                (
                  await database!.db
                    .select()
                    .from(schema.issueRun)
                    .where(eq(schema.issueRun.id, input.runId))
                )[0]?.status,
              { timeout: 60000 },
            )
            .toBe('succeeded')
          await expect
            .poll(() => JSON.stringify(harness!.getLogs()), { timeout: 60000 })
            .toContain(
              revoked
                ? 'agent_runtime.brain_summary_denied'
                : 'agent_do.brain_write_back.completed',
            )
          const results = modelRequests
            .flatMap((r) => r.messages)
            .filter((m) => m.role === 'tool')
            .map(
              (m) =>
                JSON.parse(String(m.content)) as {
                  ok: boolean
                  error?: string
                },
            )
          expect(results.length).toBeGreaterThan(0)
          if (revoked) {
            expect(results[0]).toEqual({
              ok: false,
              error:
                'No active run context; the brain tools need a workspace and agent.',
            })
            expect(mutationBoundary).toContain(
              operation === 'create' ? 'brain.ensure_indexes' : 'brain.read',
            )
            const after = brainRequests.slice(revokedAtBrainRequest!)
            for (const name of [
              'brain.index',
              'brain.update_item_metadata',
              'brain.observe_mention',
              'brain.link_items',
            ])
              expect(after.some((body) => body.includes(`"${name}"`))).toBe(
                false,
              )
            expect(await inspect()).toEqual(before)
            expect(
              await database!.db.select().from(schema.brainWriteProposal),
            ).toHaveLength(0)
          } else {
            expect(results[0]?.ok).toBe(true)
            expect(mutationBoundary).toBeUndefined()
            const persisted = JSON.stringify(await inspect())
            if (operation !== 'create')
              expect(persisted).toContain(
                operation === 'update'
                  ? 'G06_MUTATION_UPDATED'
                  : operation === 'mention'
                    ? 'G06_MUTATION_MENTION'
                    : 'G06_MUTATION_EDGE',
              )
          }
          const snapshot = await harness!.fetch('/snapshot', {
            method: 'POST',
            body: JSON.stringify({ workspaceId }),
          })
          expect(snapshot.status).toBe(200)
          if (operation === 'create')
            expect(
              (await snapshot.text()).includes('G06_MUTATION_CREATED'),
            ).toBe(!revoked)
        }, 90000)

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
      const automationOrigin = await seedAutomation()
      const writebackStart = modelRequests.length
      const writeback = await harness!.fetch('/writeback', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          agentId,
          runId: automationOrigin.runId,
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
    for (const kind of ['issue', 'automation'] as const)
      it(`rejects absent trusted ${kind} principals at every entry boundary`, async () => {
        const run =
          kind === 'issue'
            ? await seedIssue('G08 missing principal')
            : await seedAutomation()
        const objectId = 'issueId' in run ? String(run.issueId) : run.runId
        const table = kind === 'issue' ? schema.issueRun : schema.automationRun
        const before = await database!.db
          .select({ id: table.id, status: table.status })
          .from(table)
          .where(eq(table.id, run.runId))
        expect(before).toHaveLength(1)
        for (const method of [
          'beforeTurn',
          'executeWorkflowTurn',
          'completeWorkflowTurn',
          'validateBrainSummaryAccess',
        ]) {
          const response = await harness!.fetch('/binding-fault', {
            method: 'POST',
            body: JSON.stringify({
              ...run,
              kind,
              objectId,
              method,
              missingParent: true,
            }),
          })
          expect(response.status).toBe(200)
          const result = (await response.json()) as {
            denied: boolean
            message: string
          }
          expect(result.denied).toBe(true)
          expect(result.message).toContain(
            'Brain runtime principal is unavailable.',
          )
        }
        const positive = await harness!.fetch('/binding-fault', {
          method: 'POST',
          body: JSON.stringify({
            ...run,
            kind,
            objectId,
            method: 'validateBrainSummaryAccess',
            missingParent: false,
          }),
        })
        expect(await positive.json()).toEqual({ denied: false })
        expect(
          await database!.db
            .select({ id: table.id, status: table.status })
            .from(table)
            .where(eq(table.id, run.runId)),
        ).toEqual(before)
        expect(modelRequests).toHaveLength(0)
        expect(
          await database!.db.select().from(schema.brainWriteProposal),
        ).toHaveLength(0)
      }, 90_000)

    it('closes native authority connections after repeated allowed and denied checks', async () => {
      const connections = async () =>
        Number(
          (
            await database!.db.execute(
              sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and backend_type='client backend'`,
            )
          ).rows[0]!.count,
        )
      const baseline = await connections()
      const probe = async (expected: boolean, queriedRunId: string = runId) => {
        const response = await harness!.fetch('/summary-probe', {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            issueId,
            runId: queriedRunId,
            count: 30,
          }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          outcomes: Array.from({ length: 30 }, () => expected),
        })
        expect(await connections()).toBeLessThanOrEqual(baseline + 1)
      }
      await probe(true)
      await database!.db
        .update(schema.agent)
        .set({ permissions: null })
        .where(eq(schema.agent.id, agentId))
      await probe(false)
      await database!.db
        .update(schema.agent)
        .set({ permissions: { full_access: true } })
        .where(eq(schema.agent.id, agentId))
      await probe(true)
      await probe(false, 'not-a-postgres-uuid')
      await probe(true)
      expect(modelRequests).toHaveLength(0)
      expect(
        await database!.db.select().from(schema.brainWriteProposal),
      ).toHaveLength(0)
    }, 90_000)

    for (const kind of ['issue', 'automation'] as const)
      it(`fails closed on ${kind} grant provenance storage faults`, async () => {
        const run =
          kind === 'issue'
            ? await seedIssue('G08 storage faults')
            : await seedAutomation()
        const base = {
          kind,
          ...run,
          objectId: 'issueId' in run ? String(run.issueId) : run.runId,
          workspaceId,
          ownerUserId: ownerId,
        }
        const beforeBrain = brainRequests.length
        for (const fault of [
          {
            failRead: true,
            message: 'Cannot verify retained Brain access.',
            reads: 1,
          },
          {
            failPersist: true,
            message: 'Cannot persist Brain access provenance.',
            reads: 1,
          },
          {
            retained: true,
            message: 'Retained Brain history has no verified provenance.',
            reads: 1,
          },
          {
            marker: { identity: 'another principal', tools: [] },
            message: 'Retained Brain provenance is invalid',
            reads: 0,
          },
          {
            marker: {
              identity: `${kind}:${workspaceId}:${agentId}:${ownerId}`,
              tools: ['invented'],
            },
            message: 'Retained Brain provenance is invalid',
            reads: 0,
          },
        ]) {
          const response = await harness!.fetch('/grant-fault', {
            method: 'POST',
            body: JSON.stringify({ ...base, ...fault }),
          })
          expect(response.status).toBe(200)
          const result = (await response.json()) as {
            denied: boolean
            message: string
            reads: number
            persisted: unknown[]
          }
          expect(result.denied).toBe(true)
          expect(result.message).toContain(fault.message)
          expect(result.reads).toBe(fault.reads)
          expect(result.persisted).toEqual([])
        }
        const positive = await harness!.fetch('/grant-fault', {
          method: 'POST',
          body: JSON.stringify({ ...base, exposeTool: 'brain_search' }),
        })
        expect(await positive.json()).toEqual({
          denied: false,
          reads: 1,
          persisted: [
            {
              brainGrantHistory: {
                identity: `${kind}:${workspaceId}:${agentId}:${ownerId}`,
                tools: ['brain_search'],
              },
            },
          ],
        })
        expect(brainRequests.length).toBe(beforeBrain)
        expect(modelRequests).toHaveLength(0)
        expect(
          await database!.db.select().from(schema.brainWriteProposal),
        ).toHaveLength(0)
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
            agentId,
            issueId,
            runId,
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
