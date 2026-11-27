import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { listAvailableConnectorBindings } from '../connectors/availability'
import { readRunConnectorIdentity } from './run-connector-identity'
import { startIssueRun, type IssueRunEnv } from './run-service'
import { postIssueComment } from './server'

const testDbRef = vi.hoisted(() => ({ url: '', db: undefined as unknown }))

vi.mock('@garden/db/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@garden/db/runtime')>()
  return {
    ...actual,
    getPooledDb: (connectionString: string) =>
      connectionString === testDbRef.url && testDbRef.db
        ? (testDbRef.db as ReturnType<typeof actual.getPooledDb>)
        : actual.getPooledDb(connectionString),
  }
})

/**
 * Issue #383: issue runs listed per-member OAuth connections for the agent
 * owner, so Samuel's Drive request on FLO-150 saw Konan's (empty) connections.
 * A run must use the triggering member's connections, and a run with no member
 * behind it must get no per-member connections at all.
 */
describe('issue run connector identity (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    testDbRef.url = testDb.databaseUrl
    testDbRef.db = testDb.db
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function seed() {
    const workspaceId = randomUUID()
    const ownerId = randomUUID()
    const memberId = randomUUID()
    const otherMemberId = randomUUID()
    const agentId = randomUUID()
    const issueId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Connector identity workspace',
      slug: `connector-identity-${workspaceId}`,
    })
    await testDb.db.insert(schema.user).values([
      { id: ownerId, email: `${ownerId}@example.com`, name: 'Konan Owner' },
      { id: memberId, email: `${memberId}@example.com`, name: 'Samuel A' },
      {
        id: otherMemberId,
        email: `${otherMemberId}@example.com`,
        name: 'Other member',
      },
    ])
    await testDb.db.insert(schema.member).values([
      { organizationId: workspaceId, userId: memberId, role: 'member' },
      { organizationId: workspaceId, userId: otherMemberId, role: 'member' },
    ])
    await testDb.db.insert(schema.account).values([
      {
        accountId: 'owner-drive',
        providerId: 'executor:google-drive:owner',
        userId: ownerId,
        workspaceId,
        status: 'connected',
        connectorType: 'google-drive',
      },
      {
        accountId: 'member-a-drive',
        providerId: 'executor:google-drive:member-a',
        userId: memberId,
        workspaceId,
        status: 'connected',
        connectorType: 'google-drive',
      },
    ])
    await testDb.db.insert(schema.githubAppInstallation).values({
      workspaceId,
      installationId: 'install-1',
      accountLogin: 'flow-research',
    })
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Garden',
      hostName: agentId,
    })
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      number: 1,
      title: 'Create a Google Doc',
      createdBy: memberId,
    })
    return { workspaceId, ownerId, memberId, otherMemberId, agentId, issueId }
  }

  const resumedWorkflowIds: string[] = []
  const env = (): IssueRunEnv => ({
    HYPERDRIVE: { connectionString: testDb.databaseUrl },
    AgentDO: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        startIssueRunWorkflow: async () => {},
        cancelIssueRun: async () => {},
      }),
    },
    RUN_WORKFLOW: {
      get: async (id) => ({
        sendEvent: async () => {
          resumedWorkflowIds.push(id)
        },
        status: async () => ({ status: 'running' }),
      }),
    },
  })

  async function waitingRun(
    seeded: Awaited<ReturnType<typeof seed>>,
    contextSnapshot?: unknown,
  ) {
    const result = (
      await startIssueRun(env(), {
        workspaceId: seeded.workspaceId,
        issueId: seeded.issueId,
        agentId: seeded.agentId,
        source: 'manual',
        actor: { type: 'member', id: seeded.memberId },
      })
    ).unwrap()
    if (result.kind !== 'started') throw new Error(result.kind)
    await testDb.db
      .update(schema.issueRun)
      .set({
        status: 'waiting_for_input',
        ...(contextSnapshot === undefined ? {} : { contextSnapshot }),
      })
      .where(eq(schema.issueRun.id, result.runId))
    return result.runId
  }

  async function insertReply(issueId: string, authorId: string) {
    const id = randomUUID()
    await testDb.db.insert(schema.issueComment).values({
      id,
      issueId,
      authorType: 'user',
      authorId,
      body: 'Answer',
    })
    return id
  }

  async function runBindings(
    seeded: Awaited<ReturnType<typeof seed>>,
    actor: Parameters<typeof startIssueRun>[1]['actor'],
    onBehalfOfUserId?: string,
  ) {
    const started = (
      await startIssueRun(env(), {
        workspaceId: seeded.workspaceId,
        issueId: seeded.issueId,
        agentId: seeded.agentId,
        source: 'comment',
        actor,
        onBehalfOfUserId,
      })
    ).unwrap()
    if (started.kind !== 'started') throw new Error(started.kind)
    const [run] = await testDb.db
      .select({ contextSnapshot: schema.issueRun.contextSnapshot })
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, started.runId))
    const identity = readRunConnectorIdentity(run?.contextSnapshot)
    const bindings = await listAvailableConnectorBindings({
      db: testDb.db,
      userId: identity.userId,
      workspaceId: seeded.workspaceId,
    })
    return { identity, bindings }
  }

  it("uses the triggering member's per-member connections, not the owner's", async () => {
    const seeded = await seed()
    const { identity, bindings } = await runBindings(seeded, {
      type: 'member',
      id: seeded.memberId,
    })

    expect(identity).toEqual({
      userId: seeded.memberId,
      basis: 'triggering_member',
    })
    const drive = bindings.filter((b) => b.connectorId === 'google-drive')
    expect(drive.map((b) => b.accountLogin)).toEqual(['member-a-drive'])
    expect(bindings.some((b) => b.connectorId === 'github')).toBe(true)
  })

  it('gives a run with no member behind it no per-member connections', async () => {
    const seeded = await seed()
    const { identity, bindings } = await runBindings(seeded, {
      type: 'agent',
      id: seeded.agentId,
    })

    expect(identity).toEqual({ userId: null, basis: 'no_member' })
    expect(bindings.some((b) => b.authKind === 'oauth')).toBe(false)
    // Workspace-wide installs are unaffected.
    expect(bindings.some((b) => b.connectorId === 'github')).toBe(true)
  })

  it('lets a delegated agent run use the member it acts for, never the owner', async () => {
    const seeded = await seed()
    const { identity, bindings } = await runBindings(
      seeded,
      { type: 'agent', id: seeded.agentId },
      seeded.memberId,
    )

    expect(identity).toEqual({
      userId: seeded.memberId,
      basis: 'delegating_member',
    })
    const drive = bindings.filter((b) => b.connectorId === 'google-drive')
    expect(drive.map((b) => b.accountLogin)).toEqual(['member-a-drive'])
  })

  it('records the connector identity on the queued event', async () => {
    const seeded = await seed()
    await runBindings(seeded, { type: 'member', id: seeded.memberId })
    const [queued] = await testDb.db
      .select({ payload: schema.issueRunEvent.payload })
      .from(schema.issueRunEvent)
      .where(eq(schema.issueRunEvent.issueId, seeded.issueId))
    expect(queued?.payload).toMatchObject({
      connector_identity: {
        userId: seeded.memberId,
        basis: 'triggering_member',
      },
    })
  })

  it('keeps another member comment without resuming a member-bound run', async () => {
    const seeded = await seed()
    const runId = await waitingRun(seeded)
    const resumedBefore = resumedWorkflowIds.length
    const posted = (
      await postIssueComment({
        databaseUrl: testDb.databaseUrl,
        issueRunEnv: env(),
        workspaceId: seeded.workspaceId,
        issueIdOrIdentifier: seeded.issueId,
        authorUserId: seeded.otherMemberId,
        body: 'I have another thought.',
      })
    ).unwrap()
    const [comment] = await testDb.db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.id, posted.comment_id))
    const [run] = await testDb.db
      .select()
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
    expect(comment?.authorId).toBe(seeded.otherMemberId)
    expect(run?.status).toBe('waiting_for_input')
    expect(readRunConnectorIdentity(run?.contextSnapshot).userId).toBe(
      seeded.memberId,
    )
    expect(resumedWorkflowIds).toHaveLength(resumedBefore)
  })

  it('resumes when the original member comments and keeps the queued identity', async () => {
    const seeded = await seed()
    const runId = await waitingRun(seeded)
    const resumedBefore = resumedWorkflowIds.length
    const posted = await postIssueComment({
      databaseUrl: testDb.databaseUrl,
      issueRunEnv: env(),
      workspaceId: seeded.workspaceId,
      issueIdOrIdentifier: seeded.issueId,
      authorUserId: seeded.memberId,
      body: 'Yes, use my Drive.',
    })
    expect(posted.isOk()).toBe(true)
    const [run] = await testDb.db
      .select()
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
    expect(resumedWorkflowIds.slice(resumedBefore)).toEqual([runId])
    expect(readRunConnectorIdentity(run?.contextSnapshot)).toEqual({
      userId: seeded.memberId,
      basis: 'triggering_member',
    })
  })

  it('allows an older member run to resume without granting personal connections', async () => {
    const seeded = await seed()
    const runId = await waitingRun(seeded, {
      actor: { type: 'member', id: seeded.memberId },
      source: 'manual',
    })
    const commentId = await insertReply(seeded.issueId, seeded.memberId)
    const resumedBefore = resumedWorkflowIds.length
    const result = (
      await startIssueRun(env(), {
        workspaceId: seeded.workspaceId,
        issueId: seeded.issueId,
        agentId: seeded.agentId,
        source: 'comment',
        trigger: { commentId },
        actor: { type: 'member', id: seeded.memberId },
      })
    ).unwrap()
    expect(result).toEqual({ kind: 'resumed', runId })
    expect(resumedWorkflowIds.slice(resumedBefore)).toEqual([runId])
    const [run] = await testDb.db
      .select()
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
    expect(readRunConnectorIdentity(run?.contextSnapshot).userId).toBeNull()
  })

  it('refuses a waiting run with missing identity evidence', async () => {
    const seeded = await seed()
    const runId = await waitingRun(seeded, {})
    const commentId = await insertReply(seeded.issueId, seeded.memberId)
    const resumedBefore = resumedWorkflowIds.length
    const result = (
      await startIssueRun(env(), {
        workspaceId: seeded.workspaceId,
        issueId: seeded.issueId,
        agentId: seeded.agentId,
        source: 'comment',
        trigger: { commentId },
        actor: { type: 'member', id: seeded.memberId },
      })
    ).unwrap()
    expect(result).toEqual({ kind: 'already_running', runId })
    expect(resumedWorkflowIds).toHaveLength(resumedBefore)
  })

  it('refuses a forged comment author even when the claimed actor matches', async () => {
    const seeded = await seed()
    const runId = await waitingRun(seeded)
    const commentId = await insertReply(seeded.issueId, seeded.otherMemberId)
    const resumedBefore = resumedWorkflowIds.length
    const result = (
      await startIssueRun(env(), {
        workspaceId: seeded.workspaceId,
        issueId: seeded.issueId,
        agentId: seeded.agentId,
        source: 'comment',
        trigger: { commentId },
        actor: { type: 'member', id: seeded.memberId },
      })
    ).unwrap()
    expect(result).toEqual({ kind: 'already_running', runId })
    expect(resumedWorkflowIds).toHaveLength(resumedBefore)
  })
})
