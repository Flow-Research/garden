// @vitest-environment node
import { DateTime, Effect, Layer } from 'effect'
import { Brain } from '@garden/brain/services/brain'
import { ItemId, Kind, WorkspaceId, type BrainItem } from '@garden/brain/domain'
import {
  BrainFileIngestion,
  makeBrainFileIngestionLayer,
} from '@/lib/server/brain-file-ingestion'
import { BrainAuditClient } from '@/lib/server/brain-audit-runtime'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import { createAppRequestContext } from '@/lib/server/context'
import { bindAppEnv, type AppEnv } from '@/lib/server/env'
import { ensureAgentRow } from '@/lib/server/chat-agents'
import { invokeRouteHandler } from '@/test/route-handler'
import { Route as ChatRoute } from './chat/threads'
import { Route as WorkspaceRoute } from './workspaces'
import {
  seedWorkspaceActor,
  workspaceTestEnv,
  authTestOrigin,
  TEST_DB_HOOK_TIMEOUT_MS,
} from './-agent-recovery-fixture'

// Only R2 skill seeding and Workers RPC are outside this SQL/auth route proof.
vi.mock('@garden/agent-runtime', () => ({
  buildContentDisposition: () => 'inline',
  normalizeDownloadFilename: (name: string) => name,
}))
vi.mock('@/lib/server/builtin-skills', () => ({
  seedBuiltinSkills: async () => {},
}))
vi.mock('agents', () => ({
  getAgentByName: () => {
    throw new Error('Unexpected Workers RPC in SQL route proof')
  },
}))

describe('default agent recovery (Postgres and Better Auth)', () => {
  let testDb: TestDb
  let env: AppEnv
  beforeAll(async () => {
    testDb = await startTestDb()
    env = workspaceTestEnv(testDb.databaseUrl)
    env.FILES = {
      list: async () => ({ objects: [], truncated: false }),
      put: async () => null,
    } as unknown as R2Bucket
  }, TEST_DB_HOOK_TIMEOUT_MS)
  beforeEach(() => bindAppEnv(env))
  afterAll(async () => testDb?.cleanup(), TEST_DB_HOOK_TIMEOUT_MS)
  const actor = (role: 'owner' | 'admin' | 'member' = 'member') =>
    seedWorkspaceActor(testDb.db, env, role)
  type Actor = Awaited<ReturnType<typeof actor>>
  async function invoke(
    person: Actor,
    body?: unknown,
    path = '/api/chat/threads',
  ) {
    const request = new Request(`${authTestOrigin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie: person.cookie,
        origin: authTestOrigin,
        'X-Workspace-ID': person.workspaceId,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const context = createAppRequestContext(env, request)
    return invokeRouteHandler(
      path === '/api/workspaces' ? WorkspaceRoute : ChatRoute,
      body === undefined ? 'GET' : 'POST',
      { context, request },
    ).finally(() => context.close())
  }
  async function state(workspaceId: string) {
    const agents = await testDb.db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.workspaceId, workspaceId))
      .orderBy(schema.agent.id)
    const grants = await testDb.db
      .select()
      .from(schema.permissionGrant)
      .innerJoin(
        schema.agent,
        eq(schema.agent.id, schema.permissionGrant.agentId),
      )
      .where(eq(schema.agent.workspaceId, workspaceId))
      .orderBy(schema.permissionGrant.id)
    const threads = await testDb.db
      .select()
      .from(schema.chatThread)
      .where(eq(schema.chatThread.workspaceId, workspaceId))
      .orderBy(schema.chatThread.id)
    return { agents, grants, threads }
  }
  const repair = (person: Actor) =>
    ensureAgentRow({
      db: testDb.db,
      workspaceId: person.workspaceId,
      ownerUserId: person.userId,
    })
  const membership = (person: Actor) =>
    and(
      eq(schema.member.organizationId, person.workspaceId),
      eq(schema.member.userId, person.userId),
    )

  it.each(['member', 'owner'] as const)(
    'GET is read-only for %s with no default',
    async (role) => {
      const person = await actor(role)
      const before = await state(person.workspaceId)
      expect((await invoke(person)).status).toBe(200)
      expect(await state(person.workspaceId)).toEqual(before)
    },
  )
  it('denies member recovery without agent, grant or thread effects', async () => {
    const person = await actor()
    const before = await state(person.workspaceId)
    expect((await invoke(person, {})).status).toBe(403)
    expect(await state(person.workspaceId)).toEqual(before)
  })
  it.each(['owner', 'admin'] as const)(
    'repairs for current %s with explicit ownership',
    async (role) => {
      const person = await actor(role)
      expect((await invoke(person, {})).status).toBe(201)
      const saved = await state(person.workspaceId)
      expect(saved.agents).toEqual([
        expect.objectContaining({
          isDefault: true,
          ownerUserId: person.userId,
        }),
      ])
      expect(saved.threads).toHaveLength(1)
    },
  )
  it.each(['demoted', 'removed'] as const)(
    'uses fresh authority after owner is %s',
    async (change) => {
      const person = await actor('owner')
      if (change === 'demoted')
        await testDb.db
          .update(schema.member)
          .set({ role: 'member' })
          .where(membership(person))
      else await testDb.db.delete(schema.member).where(membership(person))
      const before = await state(person.workspaceId)
      const result = await repair(person)
      expect(result.isErr()).toBe(true)
      expect(await state(person.workspaceId)).toEqual(before)
    },
  )
  it.each([
    { unexpected: true },
    { agent_id: randomUUID() },
    { primary_issue_id: randomUUID() },
  ])(
    'does not repair malformed or inaccessible chat $agent_id',
    async (body) => {
      const person = await actor('owner')
      const before = await state(person.workspaceId)
      expect([400, 403]).toContain((await invoke(person, body)).status)
      expect(await state(person.workspaceId)).toEqual(before)
    },
  )
  it('uses explicit existing agent without provisioning a default', async () => {
    const person = await actor()
    const agentId = randomUUID()
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId: person.workspaceId,
      ownerUserId: person.userId,
      name: 'Existing',
      hostName: agentId,
    })
    const before = await state(person.workspaceId)
    expect((await invoke(person, { agent_id: agentId })).status).toBe(201)
    const after = await state(person.workspaceId)
    expect(after.agents).toEqual(before.agents)
    expect(after.grants).toEqual(before.grants)
  })
  it('preserves existing default ownership, configuration and grants for members', async () => {
    const owner = await actor('owner')
    const initial = (await repair(owner)).unwrap()
    await testDb.db
      .update(schema.agent)
      .set({
        name: 'Configured',
        instructions: 'Keep these instructions',
        permissions: { full_access: false },
      })
      .where(eq(schema.agent.id, initial.id))
    const member = await actor()
    await testDb.db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: owner.workspaceId,
      userId: member.userId,
      role: 'member',
    })
    const before = await state(owner.workspaceId)
    expect(
      (await invoke({ ...member, workspaceId: owner.workspaceId }, {})).status,
    ).toBe(201)
    const after = await state(owner.workspaceId)
    expect(after.agents).toEqual(before.agents)
    expect(after.grants).toEqual(before.grants)
  })
  it('serializes concurrent repairs into one unchanged default', async () => {
    const person = await actor('owner')
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repair(person)),
    )
    const ids = results.map((result) => result.unwrap().id)
    expect(new Set(ids).size).toBe(1)
    expect((await state(person.workspaceId)).agents).toHaveLength(1)
  })
  it('rolls back the agent if grant binding fails, then permits a clean retry', async () => {
    const person = await actor('owner')
    const capabilityId = randomUUID()
    await testDb.db.insert(schema.capability).values({
      id: capabilityId,
      connectorType: 'github',
      name: `recovery-${capabilityId}`,
      description: 'Test read',
      riskClass: 'read',
    })
    await testDb.db.execute(
      sql`CREATE FUNCTION reject_recovery_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture grant rejection'; END $$`,
    )
    await testDb.db.execute(
      sql`CREATE TRIGGER reject_recovery_grant BEFORE INSERT ON permission_grant FOR EACH ROW EXECUTE FUNCTION reject_recovery_grant()`,
    )
    const before = await state(person.workspaceId)
    const denied = await repair(person)
    await testDb.db.execute(
      sql`DROP TRIGGER reject_recovery_grant ON permission_grant`,
    )
    await testDb.db.execute(sql`DROP FUNCTION reject_recovery_grant()`)
    expect(denied.isErr()).toBe(true)
    expect(await state(person.workspaceId)).toEqual(before)
    expect((await repair(person)).isOk()).toBe(true)
    expect((await state(person.workspaceId)).grants.length).toBeGreaterThan(0)
  })
  it('recovers a real incomplete workspace after Garden bootstrap fails', async () => {
    const person = await actor('owner')
    const slug = `partial-${randomUUID()}`
    await testDb.db.execute(
      sql`CREATE FUNCTION reject_bootstrap_agent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture bootstrap rejection'; END $$`,
    )
    await testDb.db.execute(
      sql`CREATE TRIGGER reject_bootstrap_agent BEFORE INSERT ON agent FOR EACH ROW EXECUTE FUNCTION reject_bootstrap_agent()`,
    )
    const failed = await invoke(
      person,
      { name: 'Partial setup', slug },
      '/api/workspaces',
    )
    await testDb.db.execute(sql`DROP TRIGGER reject_bootstrap_agent ON agent`)
    await testDb.db.execute(sql`DROP FUNCTION reject_bootstrap_agent()`)
    expect(failed.status).toBe(500)
    const [workspace] = await testDb.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
    expect(workspace).toBeDefined()
    const incomplete = { ...person, workspaceId: workspace?.id ?? '' }
    expect((await state(incomplete.workspaceId)).agents).toEqual([])
    expect((await invoke(incomplete, {})).status).toBe(201)
    expect((await state(incomplete.workspaceId)).agents).toEqual([
      expect.objectContaining({ ownerUserId: person.userId, isDefault: true }),
    ])
  })
  it('normal workspace bootstrap followed by member chat preserves its owner default', async () => {
    const owner = await actor('owner')
    const response = await invoke(
      owner,
      { name: 'Normal setup', slug: `normal-${randomUUID()}` },
      '/api/workspaces',
    )
    expect(response.status).toBe(201)
    const workspace: { id: string } = await response.json()
    const member = await actor()
    await testDb.db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: workspace.id,
      userId: member.userId,
      role: 'member',
    })
    const before = await state(workspace.id)
    expect(
      (await invoke({ ...member, workspaceId: workspace.id }, {})).status,
    ).toBe(201)
    const after = await state(workspace.id)
    expect(after.agents).toEqual(before.agents)
    expect(after.grants).toEqual(before.grants)
  })
  it.each(['owner', 'admin', 'member', 'removed'] as const)(
    'Brain indexing uses fresh shared recovery for $0',
    async (role) => {
      const person = await actor(role === 'removed' ? 'owner' : role)
      if (role === 'removed')
        await testDb.db.delete(schema.member).where(membership(person))
      const item = {
        id: ItemId.make(randomUUID()),
        tenantId: WorkspaceId.make(person.workspaceId),
        kind: Kind.make('file'),
        label: 'Fixture file',
        indexed: true,
        body: 'Indexed fixture content',
        origin: {
          actor: { _tag: 'Human', userId: person.userId },
          at: DateTime.makeUnsafe(new Date()),
        },
      } as BrainItem
      const unused = () => Effect.die('Unexpected Brain operation')
      const indexStatuses: string[] = []
      const brain = Brain.of({
        ensureIndexes: () => Effect.void,
        index: () => Effect.succeed(item),
        updateIndexStatus: (input) =>
          Effect.sync(() => {
            indexStatuses.push(input.status)
            return item
          }),
        addItem: unused,
        addText: unused,
        updateItemMetadata: unused,
        deleteFile: unused,
        read: unused,
        search: unused,
        linkSections: unused,
        sectionsOf: unused,
        observeMention: unused,
        linkItems: unused,
        neighborhood: unused,
        readFileItem: unused,
        readFile: unused,
        listFiles: unused,
      })
      const audit = vi.fn(() =>
        Effect.succeed({ ok: true as const, status: 'completed' as const }),
      )
      const live = makeBrainFileIngestionLayer(env).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(Brain, brain),
            Layer.succeed(
              BrainAuditClient,
              BrainAuditClient.of({ request: audit }),
            ),
          ),
        ),
      )
      await Effect.runPromise(
        Effect.flatMap(BrainFileIngestion, (ingestion) =>
          ingestion.indexAndAudit({
            itemId: item.id,
            ownerUserId: person.userId,
            workspaceId: person.workspaceId,
          }),
        ).pipe(Effect.provide(live)),
      )
      const permitted = role === 'owner' || role === 'admin'
      expect((await state(person.workspaceId)).agents).toHaveLength(
        permitted ? 1 : 0,
      )
      expect(audit).toHaveBeenCalledTimes(permitted ? 1 : 0)
      expect(indexStatuses).toEqual(['processing'])
    },
  )
})
