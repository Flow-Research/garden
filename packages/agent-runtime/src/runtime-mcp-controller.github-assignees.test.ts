import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { Result } from 'better-result'
import { isTestDbReachable } from './test-db'
import {
  RuntimeMcpController,
  type McpHost,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'

const TEST_DB_URL =
  process.env.GARDEN_TEST_DATABASE_URL ??
  'postgres://garden@localhost:5433/garden_test'

const DB_REACHABLE = await isTestDbReachable(TEST_DB_URL)

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
    env: { HYPERDRIVE: { connectionString: TEST_DB_URL } },
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

let pool: Pool
let db: ReturnType<typeof drizzle<typeof schema>>

describe.skipIf(!DB_REACHABLE)('hosted github issue_write assignees', () => {
  const workspaceId = randomUUID()
  const userId = randomUUID()

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL })
    db = drizzle(pool, { schema })
    await db.insert(schema.user).values({
      id: userId,
      email: `${userId}@example.com`,
      name: 'Linked',
    })
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Assignee workspace',
      slug: `assignee-${workspaceId}`,
    })
    await db.insert(schema.member).values({
      organizationId: workspaceId,
      userId,
      role: 'owner',
      githubUserId: '1001',
      githubLogin: LINKED_LOGIN,
    })
  })

  afterAll(async () => {
    await db.delete(schema.member).where(eq(schema.member.userId, userId))
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, workspaceId))
    await db.delete(schema.user).where(eq(schema.user.id, userId))
    await pool.end()
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
