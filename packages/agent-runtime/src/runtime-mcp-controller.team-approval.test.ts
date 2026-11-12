import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ToolSet } from 'ai'
import { and, eq } from 'drizzle-orm'
import { Result } from 'better-result'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import {
  DEFAULT_TEAM_AGENT_POLICY,
  type TeamAgentPolicy,
} from '@garden/core/teams/agent-policy'
import { RuntimeMcpController, type McpHost } from './runtime-mcp-controller'

const CONNECTOR_ID = 'github'
const TOOL_NAME = 'add_issue_comment'
const TOOL_ARGS = { body: 'team policy probe' }

type Seeded = {
  workspaceId: string
  agentId: string
  actingUserId: string
  teamOwnerId: string
  adminId: string
}

describe('Team policy approvals (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, 120_000)

  afterAll(async () => {
    // The controller opens its own invocation-local pools (getPooledDb). Let
    // their idle clients close (pg's 10s idle timeout) before the container
    // stops, or Postgres terminating them surfaces as uncaught errors.
    await new Promise((resolve) => setTimeout(resolve, 11_000))
    await testDb?.cleanup()
  }, 60_000)

  async function seedUser(workspaceId: string, role: string) {
    const id = randomUUID()
    await testDb.db
      .insert(schema.user)
      .values({ id, email: `${id}@example.com`, name: `User ${role}` })
    await testDb.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: id, role })
    return id
  }

  /**
   * One workspace with a `write` capability and no grants, so trust resolves
   * to the `allow` default and only a Team rule can make the call wait.
   */
  async function seed(): Promise<Seeded> {
    const workspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Team approvals',
      slug: `team-approvals-${workspaceId}`,
    })
    const adminId = await seedUser(workspaceId, 'admin')
    const teamOwnerId = await seedUser(workspaceId, 'member')
    const actingUserId = await seedUser(workspaceId, 'member')
    const agentId = randomUUID()
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: adminId,
      name: 'Garden',
      isDefault: true,
    })
    const existing = await testDb.db
      .select({ id: schema.capability.id })
      .from(schema.capability)
      .where(
        and(
          eq(schema.capability.connectorType, CONNECTOR_ID),
          eq(schema.capability.name, TOOL_NAME),
        ),
      )
    if (existing.length === 0) {
      await testDb.db.insert(schema.capability).values({
        id: randomUUID(),
        connectorType: CONNECTOR_ID,
        name: TOOL_NAME,
        riskClass: 'write',
      })
    }
    return { workspaceId, agentId, actingUserId, teamOwnerId, adminId }
  }

  async function seedTeam(
    seeded: Seeded,
    name: string,
    policy: Partial<TeamAgentPolicy>,
  ) {
    const teamId = randomUUID()
    await testDb.db.insert(schema.team).values({
      id: teamId,
      workspaceId: seeded.workspaceId,
      name,
      ownerUserId: seeded.teamOwnerId,
      createdBy: seeded.adminId,
    })
    await testDb.db.insert(schema.teamMember).values(
      [seeded.teamOwnerId, seeded.actingUserId].map((userId) => ({
        teamId,
        workspaceId: seeded.workspaceId,
        userId,
        createdBy: seeded.adminId,
      })),
    )
    await testDb.db.insert(schema.teamAgentPolicy).values({
      teamId,
      workspaceId: seeded.workspaceId,
      policy: { ...DEFAULT_TEAM_AGENT_POLICY, ...policy },
      updatedBy: seeded.adminId,
    })
    return teamId
  }

  function needsApproval(seeded: Seeded, userId: string, toolCallId: string) {
    const host = {
      name: 'team-approval-probe',
      env: { HYPERDRIVE: { connectionString: testDb.databaseUrl } },
      ctx: { storage: { sql: {} } },
      mcp: {
        getAITools: () => ({}) as ToolSet,
        listTools: () => [
          { name: TOOL_NAME, serverId: CONNECTOR_ID, inputSchema: {} },
        ],
        listServers: () => [{ id: CONNECTOR_ID }],
        discoverIfConnected: async () => ({ success: true }),
      },
      removeMcpServer: async () => {},
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: randomUUID(),
          workspaceId: seeded.workspaceId,
          userId,
          agentId: seeded.agentId,
        }),
    } as unknown as McpHost
    const key = buildMcpAiToolKey(CONNECTOR_ID, TOOL_NAME)
    const wrapped = new RuntimeMcpController(host).wrapGetAITools(
      () =>
        ({
          [key]: { description: 'probe', inputSchema: {} },
        }) as unknown as ToolSet,
      undefined,
    )
    const tool = wrapped[key] as unknown as {
      needsApproval: (
        input: unknown,
        options: { toolCallId: string; messages: unknown[] },
      ) => Promise<boolean>
    }
    return tool.needsApproval(TOOL_ARGS, { toolCallId, messages: [] })
  }

  async function requestFor(toolCallId: string) {
    const [row] = await testDb.db
      .select()
      .from(schema.permissionRequest)
      .where(eq(schema.permissionRequest.toolCallId, toolCallId))
    return row
  }

  it('leaves a user on no Team on the agent settings', async () => {
    const seeded = await seed()
    const toolCallId = `none-${randomUUID()}`
    await expect(
      needsApproval(seeded, seeded.actingUserId, toolCallId),
    ).resolves.toBe(false)
    expect(await requestFor(toolCallId)).toBeUndefined()
  })

  it('holds a class the Team marks Approval required and routes it to the Team owner', async () => {
    const seeded = await seed()
    const teamId = await seedTeam(seeded, 'Technical', {
      approval_required: ['write'],
    })
    const toolCallId = `team-${randomUUID()}`
    await expect(
      needsApproval(seeded, seeded.actingUserId, toolCallId),
    ).resolves.toBe(true)

    const request = await requestFor(toolCallId)
    expect(request?.teamId).toBe(teamId)
    const inbox = await testDb.db
      .select({ recipientId: schema.inboxItem.recipientId })
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.itemKey, `approval:${request?.id}`))
    expect(inbox.map((item) => item.recipientId)).toContain(seeded.teamOwnerId)
  })

  it('names the first Team by name and lists the others in context', async () => {
    const seeded = await seed()
    const finance = await seedTeam(seeded, 'Finance', {
      approval_required: ['write'],
    })
    await seedTeam(seeded, 'Technical', { approval_required: ['write'] })
    const toolCallId = `two-${randomUUID()}`
    await expect(
      needsApproval(seeded, seeded.actingUserId, toolCallId),
    ).resolves.toBe(true)
    const request = await requestFor(toolCallId)
    expect(request?.teamId).toBe(finance)
    expect(request?.context).toContain('Technical')
  })

  it('does not hold classes the Team leaves on agent settings', async () => {
    const seeded = await seed()
    await seedTeam(seeded, 'Technical', {
      approval_required: ['send_external'],
    })
    await expect(
      needsApproval(seeded, seeded.actingUserId, `other-${randomUUID()}`),
    ).resolves.toBe(false)
  })
})
