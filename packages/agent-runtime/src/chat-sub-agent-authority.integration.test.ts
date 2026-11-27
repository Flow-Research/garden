import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { eq } from 'drizzle-orm'
import type { ChatActionContext, ChatRequestContext } from '@cloudflare/think'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { getConnectorByExecutorSlug } from '@garden/connectors/registry'
import { TEAM_AGENT_AREAS } from '@garden/core/teams/agent-policy'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import type { ChatSubAgent } from './agent-do'
import {
  browserChatTags,
  type BrowserChatPrincipal,
} from './browser-chat-authority'

type ChatSubAgentClass = typeof ChatSubAgent
type AgentConstructor = new (context: unknown, env: unknown) => object

const databaseKey = '__gardenChatSubAgentAuthorityDatabase'
const bundlePath = fileURLToPath(
  new URL(
    `../node_modules/.cache/chat-sub-agent-authority/${randomUUID()}.mjs`,
    import.meta.url,
  ),
)
let database: TestDb
let ChatSubAgentRuntime: ChatSubAgentClass

/**
 * Builds the production module for Node. Only the Cloudflare platform imports
 * and the database pool leaf are replaced; every Garden and SDK module is the
 * installed source. The pool leaf returns the suite database so that no pool
 * outlives the container, as the approval suites do with `vi.mock`.
 */
async function loadChatSubAgent() {
  await build({
    entryPoints: [fileURLToPath(new URL('./agent-do.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    outfile: bundlePath,
    logLevel: 'silent',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'garden-node-leaves',
        setup(builder) {
          builder.onResolve({ filter: /\?raw$/ }, async (args) => ({
            path: (
              await builder.resolve(args.path.slice(0, -'?raw'.length), {
                kind: args.kind,
                resolveDir: args.resolveDir,
              })
            ).path,
            namespace: 'raw-text',
          }))
          builder.onLoad(
            { filter: /.*/, namespace: 'raw-text' },
            async (args) => ({
              contents: await readFile(args.path, 'utf8'),
              loader: 'text',
            }),
          )
          builder.onResolve({ filter: /^cloudflare:/ }, (args) => ({
            path: args.path,
            namespace: 'platform',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({
            contents:
              'class Base { constructor(ctx, env) { this.ctx = ctx; this.env = env } } export class DurableObject extends Base {} export class WorkflowEntrypoint extends Base {} export class WorkerEntrypoint extends Base {} export class RpcTarget {} export class EmailMessage {} export const exports = {}; export const env = {}; export function waitUntil() {}',
          }))
          builder.onResolve(
            { filter: /^@garden\/db\/runtime$/ },
            async (args) => {
              if (args.pluginData === 'actual') return undefined
              const actual = await builder.resolve(args.path, {
                kind: args.kind,
                resolveDir: args.resolveDir,
                pluginData: 'actual',
              })
              return { path: actual.path, namespace: 'suite-database' }
            },
          )
          builder.onLoad(
            { filter: /.*/, namespace: 'suite-database' },
            (args) => ({
              contents: `export * from ${JSON.stringify(args.path)}; export function getPooledDb() { return globalThis[${JSON.stringify(databaseKey)}] }`,
              resolveDir: fileURLToPath(new URL('.', import.meta.url)),
            }),
          )
        },
      },
    ],
  })
  const module = (await import(pathToFileURL(bundlePath).href)) as {
    ChatSubAgent: ChatSubAgentClass
  }
  return module.ChatSubAgent
}

beforeAll(async () => {
  database = await startTestDb()
  Reflect.set(globalThis, databaseKey, database.db)
  await mkdir(fileURLToPath(new URL('.', pathToFileURL(bundlePath))), {
    recursive: true,
  })
  ChatSubAgentRuntime = await loadChatSubAgent()
}, 180_000)

afterAll(async () => {
  Reflect.deleteProperty(globalThis, databaseKey)
  await rm(bundlePath, { force: true })
  await database?.cleanup()
})

async function fixture() {
  const principal: BrowserChatPrincipal = {
    sessionId: randomUUID(),
    userId: randomUUID(),
    workspaceId: randomUUID(),
    agentId: randomUUID(),
    threadId: randomUUID(),
    runtimeKey: randomUUID(),
    runtimeName: randomUUID(),
  }
  await database.db.insert(schema.user).values({
    id: principal.userId,
    email: `${principal.userId}@example.test`,
  })
  await database.db.insert(schema.organization).values({
    id: principal.workspaceId,
    name: 'Chat facet authority',
    slug: principal.workspaceId,
  })
  await database.db.insert(schema.member).values({
    userId: principal.userId,
    organizationId: principal.workspaceId,
    role: 'owner',
  })
  await database.db.insert(schema.agent).values({
    id: principal.agentId,
    workspaceId: principal.workspaceId,
    ownerUserId: principal.userId,
    name: 'Chat facet agent',
    hostName: principal.runtimeName,
  })
  await database.db.insert(schema.chatThread).values({
    title: 'Chat facet thread',
    id: principal.threadId,
    runtimeKey: principal.runtimeKey,
    workspaceId: principal.workspaceId,
    agentId: principal.agentId,
    ownerUserId: principal.userId,
  })
  await database.db.insert(schema.session).values({
    id: principal.sessionId,
    token: randomUUID(),
    userId: principal.userId,
    expiresAt: new Date(Date.now() + 600_000),
    activeOrganizationId: principal.workspaceId,
  })
  const rootId = randomUUID()
  const connectionId = randomUUID()
  // PartyServer lists the connection ID before the tags that Garden supplies.
  const tags = [connectionId, ...browserChatTags(principal)]
  const request: ChatRequestContext = {
    version: 1,
    requestId: rootId,
    rootRequestId: rootId,
    source: { kind: 'connection', connectionId, connectionTags: tags },
  }
  return { principal, request, connection: { id: connectionId, tags } }
}

/**
 * Constructs the SDK base with controlled platform storage, then gives the
 * object the production prototype. The Think constructor needs Durable Object
 * SQLite; the methods under test read PostgreSQL only.
 */
function facet(name: string) {
  const Think = Object.getPrototypeOf(ChatSubAgentRuntime) as object
  const Agent = Object.getPrototypeOf(Think) as AgentConstructor
  class DispatchAgent extends Agent {}
  const context = {
    id: { name },
    storage: {
      sql: { exec: () => Object.assign([], { toArray: () => [] }) },
      get: async () => undefined,
    },
    getWebSockets: () => [],
  }
  const agent = Reflect.construct(DispatchAgent, [
    context,
    { HYPERDRIVE: { connectionString: database.databaseUrl } },
  ])
  Object.setPrototypeOf(agent, ChatSubAgentRuntime.prototype)
  return agent as InstanceType<ChatSubAgentClass>
}

function admit(
  agent: InstanceType<ChatSubAgentClass>,
  request: ChatRequestContext,
  changes: Partial<ChatActionContext> = {},
) {
  return agent.beforeChatAction({ action: 'model-call', request, ...changes })
}

async function setAgentPermissions(agentId: string, permissions: unknown) {
  await database.db
    .update(schema.agent)
    .set({ permissions })
    .where(eq(schema.agent.id, agentId))
}

async function setTeamPolicy(
  principal: BrowserChatPrincipal,
  policy: Record<string, unknown>,
) {
  const teamId = randomUUID()
  await database.db.insert(schema.team).values({
    id: teamId,
    workspaceId: principal.workspaceId,
    name: `Policy ${teamId}`,
    ownerUserId: principal.userId,
    createdBy: principal.userId,
  })
  await database.db.insert(schema.teamMember).values({
    id: randomUUID(),
    teamId,
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    createdBy: principal.userId,
  })
  await database.db.insert(schema.teamAgentPolicy).values({
    teamId,
    workspaceId: principal.workspaceId,
    policy: {
      allowed_areas: [...TEAM_AGENT_AREAS],
      blocked_risk_classes: [],
      blocked_connector_ids: [],
      approval_required: [],
      ...policy,
    },
    updatedBy: principal.userId,
  })
}

const refusedAccess = 'Private chat access is unavailable'
const refusedTool = 'Current chat tool authority refuses this action.'

describe('the production ChatSubAgent authority hooks against actual PostgreSQL', () => {
  it('admits the current browser scope and refuses it after session revocation', async () => {
    const { principal, request } = await fixture()
    const agent = facet(principal.runtimeKey)
    await expect(admit(agent, request)).resolves.toBeUndefined()
    await expect(
      admit(facet(randomUUID()), request),
      'another runtime',
    ).rejects.toThrow(refusedAccess)
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    await expect(admit(agent, request)).rejects.toThrow(refusedAccess)
  })

  it('refuses a tool that the current agent permissions exclude', async () => {
    const { principal, request } = await fixture()
    const agent = facet(principal.runtimeKey)
    const tool = (toolName: string) =>
      admit(agent, request, {
        action: 'execute-tool',
        toolCallId: randomUUID(),
        toolName,
        input: {},
      })
    await expect(tool('create_issue')).resolves.toBeUndefined()
    await setAgentPermissions(principal.agentId, {
      full_access: false,
      allowed_tools: ['read_issue'],
    })
    await expect(tool('create_issue')).rejects.toThrow(refusedTool)
    await expect(tool('read_issue')).resolves.toBeUndefined()
    await expect(
      admit(agent, request, {
        action: 'dispatch-client-tool',
        toolCallId: randomUUID(),
        toolName: 'create_issue',
        input: {},
      }),
    ).rejects.toThrow(refusedTool)
    await expect(
      admit(agent, request, {
        action: 'execute-tool',
        toolCallId: randomUUID(),
      }),
    ).rejects.toThrow('Current chat tool authority is unavailable.')
  })

  it('refuses a tool whose area the current Team policy removes', async () => {
    const { principal, request } = await fixture()
    const agent = facet(principal.runtimeKey)
    const tool = (toolName: string, input: unknown = {}) =>
      admit(agent, request, {
        action: 'execute-tool',
        toolCallId: randomUUID(),
        toolName,
        input,
      })
    const executor = buildMcpAiToolKey('executor', 'execute')
    await expect(tool('create_issue')).resolves.toBeUndefined()
    await expect(tool(executor)).resolves.toBeUndefined()
    const githubRead = buildMcpAiToolKey('github', 'get_issue')
    await expect(tool(githubRead)).resolves.toBeUndefined()
    await setTeamPolicy(principal, {
      allowed_areas: TEAM_AGENT_AREAS.filter(
        (area) => area !== 'tasks' && area !== 'connections',
      ),
    })
    await expect(tool('create_issue')).rejects.toThrow(refusedTool)
    await expect(tool(executor)).rejects.toThrow(refusedTool)
    await expect(tool(githubRead)).rejects.toThrow(refusedTool)
    await expect(tool('brain_search')).resolves.toBeUndefined()
  })

  it('refuses an Executor call that names a connector the Team policy blocks', async () => {
    const { principal, request } = await fixture()
    const agent = facet(principal.runtimeKey)
    const connector = getConnectorByExecutorSlug('google_drive')
    if (!connector) throw new Error('The Google Drive connector is absent')
    const call = () =>
      admit(agent, request, {
        action: 'execute-tool',
        toolCallId: randomUUID(),
        toolName: buildMcpAiToolKey('executor', 'execute'),
        input: {
          code: 'await tools.google_drive.user.docs.drive.files.list({})',
        },
      })
    await expect(call()).resolves.toBeUndefined()
    await setTeamPolicy(principal, { blocked_connector_ids: [connector.id] })
    await expect(call()).rejects.toThrow(refusedTool)
  })

  it('returns the current server tags for the bound connection only', async () => {
    const { principal, connection } = await fixture()
    const agent = facet(principal.runtimeKey)
    const tags = (target: InstanceType<ChatSubAgentClass>, value: unknown) =>
      Reflect.apply(target.getConnectionTags, target, [value, {}])
    await expect(tags(agent, connection)).resolves.toEqual(
      browserChatTags(principal),
    )
    await expect(tags(facet(randomUUID()), connection)).rejects.toThrow(
      'Private chat scope does not match this runtime.',
    )
    await expect(
      tags(agent, { id: randomUUID(), tags: ['garden.browser.bound.v1'] }),
    ).rejects.toThrow(refusedAccess)
    await database.db
      .delete(schema.member)
      .where(eq(schema.member.userId, principal.userId))
    await expect(tags(agent, connection)).rejects.toThrow(refusedAccess)
  })

  it('accepts the proposal continuation from browser RPC and passes its exact decision context', async () => {
    const { principal, connection } = await fixture()
    const agent = facet(principal.runtimeKey)
    const saveMessages = vi.fn(async () => ({ status: 'completed' }))
    const release = vi.fn()
    Object.defineProperties(agent, {
      saveMessages: { value: saveMessages },
      releaseChatRequestReference: { value: release },
    })
    const dispatch = async (input: unknown) => {
      const sent: string[] = []
      const id = randomUUID()
      await Reflect.apply(agent.onMessage, agent, [
        {
          ...connection,
          uri: `https://garden.test/agents/chat-sub-agent/${principal.runtimeKey}`,
          state: null,
          setState: () => null,
          send: (value: string) => sent.push(value),
        },
        JSON.stringify({
          type: 'rpc',
          id,
          method: 'continueAfterGardenApproval',
          args: [input],
        }),
      ])
      return sent.map(
        (value) => JSON.parse(value) as { error?: string; result?: unknown },
      )
    }
    const permissionRequestId = randomUUID()
    const pendingAgentId = randomUUID()
    expect(
      await dispatch({
        approved: true,
        permissionRequestId,
        pendingAgentId: null,
      }),
    ).toContainEqual(
      expect.objectContaining({
        error: 'Agent proposal continuation input is invalid.',
      }),
    )
    expect(saveMessages).not.toHaveBeenCalled()
    expect(
      await dispatch({ approved: true, permissionRequestId, pendingAgentId }),
    ).toContainEqual(
      expect.objectContaining({ result: { ok: true, status: 'completed' } }),
    )
    expect(saveMessages).toHaveBeenCalledOnce()
    expect(saveMessages.mock.calls[0]?.at(1)).toEqual({
      parentReference: `garden-proposal:${permissionRequestId}`,
      applicationContext: {
        kind: 'garden-approval',
        permissionRequestId,
        pendingAgentId,
        approved: true,
      },
    })
    expect(release).toHaveBeenCalledWith(
      `garden-proposal:${permissionRequestId}`,
    )
  })
})
