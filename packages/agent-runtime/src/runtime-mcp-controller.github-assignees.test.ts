import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { Result } from 'better-result'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  RuntimeMcpController,
  type McpHost,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'

const dbFactory = vi.hoisted(() => ({
  getPooledDb: vi.fn<typeof runtimeDb.getPooledDb>(),
}))

/**
 * Reuses the real test DB client so runtime pools cannot outlive the container.
 * Separate pools raised 57P01 during teardown. Follows the test pattern in
 * packages/server/src/issues/list-issues.integration.test.ts.
 */
vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtimeDb>()),
  getPooledDb: dbFactory.getPooledDb,
}))

const LINKED_LOGIN = 'linked-dev'

type ExecutableTool = {
  execute: (input: unknown, options: unknown) => Promise<unknown>
}

/**
 * Drives the hosted GitHub MCP `issue_write` through the controller's real
 * tool assembly (`wrapGetAITools`). The hosted tool list and the active
 * installation are normally filled by the turn's connector refresh, which
 * needs a live GitHub App; the test sets those two fields directly and
 * stubs `githubHostedMcp.callTool` to observe whether a call reaches GitHub.
 */
function hostedIssueWrite(workspaceId: string) {
  const callTool = vi.fn(async () => ({ ok: true }))
  const identity: ThreadRuntimeIdentity = {
    threadId: randomUUID(),
    workspaceId,
    userId: randomUUID(),
    agentId: randomUUID(),
  }
  const host = {
    name: 'github-assignee-probe',
    env: { HYPERDRIVE: { connectionString: testDb.databaseUrl } },
    ctx: { storage: { sql: {} } },
    mcp: {
      getAITools: () => ({}) as ToolSet,
      listTools: () => [],
      listServers: () => [],
    },
    githubHostedMcp: { listTools: async () => [], callTool },
    resolveRuntimeIdentity: async () => Result.ok(identity),
  } as unknown as McpHost

  const controller = new RuntimeMcpController(host)
  const internals = controller as unknown as {
    activeNativeConnectorAccounts: Map<string, unknown>
    activeGitHubHostedMcpTools: unknown[]
  }
  internals.activeNativeConnectorAccounts.set('github', {
    accountId: '42',
    status: 'connected',
  })
  internals.activeGitHubHostedMcpTools = [
    { name: 'issue_write', description: 'hosted', inputSchema: {} },
  ]

  const tools = controller.wrapGetAITools(() => ({}) as ToolSet, undefined)
  const tool = tools[
    buildMcpAiToolKey('github-mcp', 'issue_write')
  ] as unknown as ExecutableTool
  return {
    callTool,
    run: (input: unknown) =>
      tool.execute(input, { toolCallId: randomUUID(), messages: [] }),
  }
}

let testDb: TestDb

describe('hosted github issue_write assignees', () => {
  const workspaceId = randomUUID()
  const userId = randomUUID()

  /** Uses @garden/db/testing so missing Postgres fails setup instead of skipping checks. */
  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation((connectionString) => {
      if (connectionString !== testDb.databaseUrl) {
        throw new Error('Expected the suite-owned database connection')
      }
      return testDb.db
    })
    await testDb.db.insert(schema.user).values({
      id: userId,
      email: `${userId}@example.com`,
      name: 'Linked',
    })
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Assignee workspace',
      slug: `assignee-${workspaceId}`,
    })
    await testDb.db.insert(schema.member).values({
      organizationId: workspaceId,
      userId,
      role: 'owner',
      githubUserId: '1001',
      githubLogin: LINKED_LOGIN,
    })
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('rejects an unlinked login before calling GitHub', async () => {
    const { run, callTool } = hostedIssueWrite(workspaceId)
    const result = await run({
      method: 'create',
      owner: 'o',
      repo: 'r',
      title: 't',
      assignees: ['stranger'],
    })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('stranger'),
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  // #294: a present `assignees` that is not an array of strings used to skip
  // the linked-login check entirely and reach GitHub.
  it.each([
    ['a bare string', 'stranger'],
    ['an array with a non-string entry', [LINKED_LOGIN, 42]],
    ['an object', { login: 'stranger' }],
  ])('rejects assignees given as %s on create', async (_label, assignees) => {
    const { run, callTool } = hostedIssueWrite(workspaceId)
    const result = await run({
      method: 'create',
      owner: 'o',
      repo: 'r',
      title: 't',
      assignees,
    })
    expect(result).toMatchObject({ error: true })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refuses assignees on update so existing assignees survive', async () => {
    const { run, callTool } = hostedIssueWrite(workspaceId)
    const result = await run({
      method: 'update',
      owner: 'o',
      repo: 'r',
      issue_number: 7,
      assignees: [LINKED_LOGIN],
    })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('github.issue_write'),
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refuses an empty assignee list on update so it cannot clear assignees', async () => {
    const { run, callTool } = hostedIssueWrite(workspaceId)
    const result = await run({
      method: 'update',
      owner: 'o',
      repo: 'r',
      issue_number: 7,
      assignees: [],
    })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('github.issue_write'),
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('passes a linked login on create through to GitHub', async () => {
    const { run, callTool } = hostedIssueWrite(workspaceId)
    const input = {
      method: 'create',
      owner: 'o',
      repo: 'r',
      title: 't',
      assignees: [LINKED_LOGIN.toUpperCase()],
    }
    await expect(run(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'issue_write', input)
  })

  it('leaves an update without assignees untouched', async () => {
    const { run, callTool } = hostedIssueWrite(workspaceId)
    const input = { method: 'update', owner: 'o', repo: 'r', issue_number: 7 }
    await expect(run(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledOnce()
  })
})
