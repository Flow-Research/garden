import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createIssueFromChat } from './chat-sub-agent-tools'

const dbFactory = vi.hoisted(() => ({
  getPooledDb: vi.fn<typeof runtimeDb.getPooledDb>(),
}))

/**
 * Reuses the suite's test DB client so no second pool outlives the container.
 * Same pattern as runtime-mcp-controller.github-assignees.test.ts.
 */
vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtimeDb>()),
  getPooledDb: dbFactory.getPooledDb,
}))

// chat-sub-agent-tools imports Workers-only modules (`cloudflare:` URLs) for its
// sandbox and execute tools; this suite only drives create_issue, so stub them.
vi.mock('@cloudflare/shell', () => ({}))
vi.mock('@cloudflare/think/tools/execute', () => ({}))

type ChatContext = Parameters<typeof createIssueFromChat>[0]

let testDb: TestDb

/**
 * The chat `create_issue` tool must file Team issues under the same Team rules
 * as the web route: the chat owner acts as creator, `assignee_member` resolves
 * like `assign_issue`, and the issue service refuses disallowed assignees.
 */
describe('chat create_issue with team_id (integration)', () => {
  const workspaceId = randomUUID()
  const ownerId = randomUUID()
  const memberId = randomUUID()
  const teammateId = randomUUID()
  const agentId = randomUUID()
  const teamId = randomUUID()
  const threadId = randomUUID()

  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation(() => testDb.db)
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Chat create workspace',
      slug: `chat-create-${workspaceId}`,
    })
    const people = [
      { id: ownerId, name: 'Olu Owner', role: 'owner' },
      { id: memberId, name: 'Mira Member', role: 'member' },
      { id: teammateId, name: 'Tade Teammate', role: 'member' },
    ]
    await testDb.db.insert(schema.user).values(
      people.map((p) => ({
        id: p.id,
        name: p.name,
        email: `${p.id}@example.com`,
      })),
    )
    await testDb.db.insert(schema.member).values(
      people.map((p) => ({
        organizationId: workspaceId,
        userId: p.id,
        role: p.role,
      })),
    )
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Chat agent',
      hostName: agentId,
      permissions: { full_access: true },
    })
    await testDb.db.insert(schema.team).values({
      id: teamId,
      workspaceId,
      name: 'Engineering',
      ownerUserId: ownerId,
      createdBy: ownerId,
    })
    await testDb.db.insert(schema.teamMember).values(
      [ownerId, memberId, teammateId].map((userId) => ({
        id: randomUUID(),
        teamId,
        workspaceId,
        userId,
        createdBy: ownerId,
      })),
    )
    // The chat belongs to a normal Team member, so only self-assignment is allowed.
    await testDb.db.insert(schema.chatThread).values({
      id: threadId,
      workspaceId,
      ownerUserId: memberId,
      agentId,
      runtimeKey: randomUUID(),
      title: 'Chat',
    })
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  function context(): ChatContext {
    return {
      databaseUrl: testDb.databaseUrl,
      threadId,
      issueRunEnv: {} as ChatContext['issueRunEnv'],
    }
  }

  it('creates the issue on the Team assigned to the resolved member', async () => {
    const result = await createIssueFromChat(context(), {
      title: 'Team chat issue',
      team_id: teamId,
      assignee_member: 'Mira',
    })
    expect(result.isOk()).toBe(true)
    const issueId = result.isOk() ? result.value.issue_id : ''
    const [row] = await testDb.db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, issueId))
    expect(row).toMatchObject({
      teamId,
      createdBy: memberId,
      assigneeType: 'user',
      assigneeId: memberId,
    })
  })

  it('refuses a normal member assigning a teammate', async () => {
    const result = await createIssueFromChat(context(), {
      title: 'Assign teammate',
      team_id: teamId,
      assignee_member: 'Tade',
    })
    expect(result.isErr()).toBe(true)
    expect(result.isErr() ? result.error : '').toContain(
      'Team members can only assign issues to themselves',
    )
  })
})
