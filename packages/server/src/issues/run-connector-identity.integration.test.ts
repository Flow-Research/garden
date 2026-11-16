import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { listAvailableConnectorBindings } from '../connectors/availability'
import { readRunConnectorIdentity } from './run-connector-identity'
import { startIssueRun, type IssueRunEnv } from './run-service'

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
    return { workspaceId, ownerId, memberId, agentId, issueId }
  }

  const env = (): IssueRunEnv => ({
    HYPERDRIVE: { connectionString: testDb.databaseUrl },
    AgentDO: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        startIssueRunWorkflow: async () => {},
        cancelIssueRun: async () => {},
      }),
    } as unknown as IssueRunEnv['AgentDO'],
  })

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
})
