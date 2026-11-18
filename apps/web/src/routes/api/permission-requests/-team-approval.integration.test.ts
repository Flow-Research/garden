import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  TEST_DB_HOOK_TIMEOUT_MS,
  handlerFor,
  invocation,
  jsonRequest,
  makeContext,
  seedTeamRow,
  seedUser,
  seedWorkspace,
  type FakeRole,
} from '../teams/-fixtures'
import { Route as ResolveRoute } from './$id/resolve'

describe('Team owner approvals (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  /**
   * A workspace with two Teams and one pending connector approval that the
   * Technical Team's agent policy held, so `team_id` names Technical.
   */
  async function seed() {
    const fixture = await seedWorkspace(testDb)
    const technicalOwnerId = fixture.memberId
    const financeOwnerId = fixture.otherId
    const technicalId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Technical',
      ownerUserId: technicalOwnerId,
    })
    await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Finance',
      ownerUserId: financeOwnerId,
    })
    const capabilityId = randomUUID()
    await testDb.db.insert(schema.capability).values({
      id: capabilityId,
      connectorType: 'github',
      name: `team_probe_${capabilityId}`,
      riskClass: 'write',
    })
    const requestId = randomUUID()
    await testDb.db.insert(schema.permissionRequest).values({
      id: requestId,
      agentId: fixture.activeAgentId,
      kind: 'connector_write',
      capabilityId,
      teamId: technicalId,
      argsJson: { body: 'hello' },
      toolCallId: `call-${requestId}`,
      status: 'pending',
    })
    return { fixture, technicalId, technicalOwnerId, financeOwnerId, requestId }
  }

  async function resolveAs(args: {
    workspaceId: string
    requestId: string
    userId: string
    role: FakeRole
  }) {
    const url = `https://garden.test/api/permission-requests/${args.requestId}/resolve`
    const request = jsonRequest(url, args.workspaceId, 'POST', {
      approved: true,
    })
    return handlerFor(
      ResolveRoute,
      'POST',
    )(
      invocation(
        makeContext({ testDb, userId: args.userId, role: args.role, request }),
        request,
        { id: args.requestId },
        url,
      ),
    )
  }

  async function statusOf(requestId: string) {
    const [row] = await testDb.db
      .select({ status: schema.permissionRequest.status })
      .from(schema.permissionRequest)
      .where(eq(schema.permissionRequest.id, requestId))
    return row?.status
  }

  it('lets the Team owner resolve their Team request', async () => {
    const { fixture, technicalOwnerId, requestId } = await seed()
    const response = await resolveAs({
      workspaceId: fixture.workspaceId,
      requestId,
      userId: technicalOwnerId,
      role: 'member',
    })
    expect(response.status).toBe(200)
    expect(await statusOf(requestId)).toBe('approved')
  })

  it('refuses another Team owner', async () => {
    const { fixture, financeOwnerId, requestId } = await seed()
    const response = await resolveAs({
      workspaceId: fixture.workspaceId,
      requestId,
      userId: financeOwnerId,
      role: 'member',
    })
    expect(response.status).toBe(403)
    expect(await statusOf(requestId)).toBe('pending')
  })

  it('still lets a workspace admin resolve it', async () => {
    const { fixture, requestId } = await seed()
    const response = await resolveAs({
      workspaceId: fixture.workspaceId,
      requestId,
      userId: fixture.adminId,
      role: 'admin',
    })
    expect(response.status).toBe(200)
    expect(await statusOf(requestId)).toBe('approved')
  })

  it('follows an ownership transfer to the new owner', async () => {
    const { fixture, technicalId, technicalOwnerId, requestId } = await seed()
    const newOwnerId = await seedUser(testDb, fixture.workspaceId, 'member')
    await testDb.db.insert(schema.teamMember).values({
      teamId: technicalId,
      workspaceId: fixture.workspaceId,
      userId: newOwnerId,
      createdBy: fixture.adminId,
    })
    await testDb.db
      .update(schema.team)
      .set({ ownerUserId: newOwnerId })
      .where(eq(schema.team.id, technicalId))

    const previous = await resolveAs({
      workspaceId: fixture.workspaceId,
      requestId,
      userId: technicalOwnerId,
      role: 'member',
    })
    expect(previous.status).toBe(403)

    const current = await resolveAs({
      workspaceId: fixture.workspaceId,
      requestId,
      userId: newOwnerId,
      role: 'member',
    })
    expect(current.status).toBe(200)
    expect(await statusOf(requestId)).toBe('approved')
  })
})
