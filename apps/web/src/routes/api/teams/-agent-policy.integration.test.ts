import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_TEAM_AGENT_POLICY } from '@garden/core/teams/agent-policy'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { AppRequestContext } from '@/lib/server/context'
import {
  TEST_DB_HOOK_TIMEOUT_MS,
  handlerFor,
  invocation,
  jsonRequest,
  makeContext,
  seedTeamRow,
  seedWorkspace,
  type FakeRole,
} from './-fixtures'
import { Route as AgentPolicyRoute } from './$teamId/agent-policy'

type Published = { type: string; payload: Record<string, unknown> }

/** Fixture context plus a realtime binding that records published envelopes. */
function contextWithRealtime(
  args: Parameters<typeof makeContext>[0],
  published: Published[],
  pending: Promise<unknown>[],
): AppRequestContext {
  return {
    ...makeContext(args),
    env: {
      WORKSPACE_REALTIME: {
        idFromName: (name: string) => name,
        get: () => ({
          publish: async (envelope: Published) => {
            published.push(envelope)
          },
        }),
      },
    } as unknown as AppRequestContext['env'],
    waitUntil: (promise) => {
      pending.push(promise)
    },
  }
}

describe('Team agent policy API (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function call(args: {
    method: 'GET' | 'PUT'
    workspaceId: string
    teamId: string
    userId: string
    role: FakeRole
    body?: unknown
    published?: Published[]
  }) {
    const url = `https://garden.test/api/teams/${args.teamId}/agent-policy`
    const request = jsonRequest(url, args.workspaceId, args.method, args.body)
    const pending: Promise<unknown>[] = []
    const context = contextWithRealtime(
      { testDb, userId: args.userId, role: args.role, request },
      args.published ?? [],
      pending,
    )
    const response = await handlerFor(
      AgentPolicyRoute,
      args.method,
    )(invocation(context, request, { teamId: args.teamId }, url))
    await Promise.all(pending)
    return response
  }

  async function seed() {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Technical',
      ownerUserId: fixture.memberId,
      memberUserIds: [fixture.otherId],
    })
    return { fixture, teamId }
  }

  const strictPolicy = {
    allowed_areas: ['tasks', 'connections'],
    blocked_risk_classes: ['destructive'],
    blocked_connector_ids: ['github'],
    approval_required: ['send_external'],
  }

  it('returns the no-limits default when no policy is stored', async () => {
    const { fixture, teamId } = await seed()
    const response = await call({
      method: 'GET',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.adminId,
      role: 'admin',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      team_id: teamId,
      policy: DEFAULT_TEAM_AGENT_POLICY,
      can_edit: true,
      updated_at: null,
    })
  })

  it('lets an admin replace the policy and publishes IDs only', async () => {
    const { fixture, teamId } = await seed()
    const published: Published[] = []
    const response = await call({
      method: 'PUT',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.adminId,
      role: 'admin',
      body: strictPolicy,
      published,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).policy).toEqual(strictPolicy)
    expect(published).toHaveLength(1)
    expect(published[0]?.type).toBe('team:policy_updated')
    expect(published[0]?.payload).toEqual({
      workspace_id: fixture.workspaceId,
      team_id: teamId,
    })

    const read = await call({
      method: 'GET',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.ownerId,
      role: 'owner',
    })
    expect((await read.json()).policy).toEqual(strictPolicy)
  })

  it('lets the Team owner read the policy but refuses a write', async () => {
    const { fixture, teamId } = await seed()
    const read = await call({
      method: 'GET',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.memberId,
      role: 'member',
    })
    expect(read.status).toBe(200)
    expect((await read.json()).can_edit).toBe(false)

    const published: Published[] = []
    const write = await call({
      method: 'PUT',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.memberId,
      role: 'member',
      body: strictPolicy,
      published,
    })
    expect(write.status).toBe(403)
    expect(await write.json()).toMatchObject({ code: 'TEAM_ACCESS_DENIED' })
    expect(published).toEqual([])
  })

  it('refuses a plain Team member a read', async () => {
    const { fixture, teamId } = await seed()
    const response = await call({
      method: 'GET',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.otherId,
      role: 'member',
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TEAM_ACCESS_DENIED' })
  })

  it.each([
    ['a Coming soon area', { allowed_areas: ['chats'] }],
    ['a Coming soon restriction', { blocked_risk_classes: ['manage_billing'] }],
    ['a Coming soon approval row', { approval_required: ['deploy_changes'] }],
    ['an Admin Policy key', { admin_policy: {} }],
  ])('rejects %s with an error envelope', async (_label, overrides) => {
    const { fixture, teamId } = await seed()
    const response = await call({
      method: 'PUT',
      workspaceId: fixture.workspaceId,
      teamId,
      userId: fixture.adminId,
      role: 'admin',
      body: { ...DEFAULT_TEAM_AGENT_POLICY, ...overrides },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: 'TEAM_AGENT_POLICY_INVALID',
      error: expect.any(String),
    })
  })
})
