import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { agentSkillTarget } from '@garden/core/skills'
import { loadRuntimeSkillAssignments } from './skills'
import { startTestDb, type TestDb } from '@garden/db/testing'

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

vi.mock('agents/skills', () => ({
  r2: () => ({
    id: 'mock',
    fingerprint: 'mock',
    list: async () => [],
    load: async () => null,
  }),
}))

let testDb: TestDb

type Seeded = {
  ownerId: string
  workspaceId: string
  agentId: string
  skillIds: string[]
}

async function seedBase(agentPermissions: unknown): Promise<Seeded> {
  const ownerId = randomUUID()
  const workspaceId = randomUUID()
  const agentId = randomUUID()

  await testDb.db.insert(schema.user).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    name: 'Owner',
  })
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Skills workspace',
    slug: `skills-${workspaceId}`,
  })
  await testDb.db.insert(schema.member).values({
    organizationId: workspaceId,
    userId: ownerId,
    role: 'owner',
  })
  await testDb.db.insert(schema.agent).values({
    id: agentId,
    workspaceId,
    ownerUserId: ownerId,
    name: 'Garden',
    isDefault: false,
    permissions: agentPermissions,
  })

  const skillIds: string[] = []
  for (const [name, slug] of [
    ['PDF', 'pdf'],
    ['Spreadsheet', 'xlsx'],
  ] as const) {
    const skillId = randomUUID()
    await testDb.db.insert(schema.skill).values({
      id: skillId,
      workspaceId,
      name,
      slug,
    })
    await testDb.db.insert(schema.skillAssignment).values({
      workspaceId,
      targetKind: 'agent',
      targetId: agentId,
      skillId,
      enabled: true,
    })
    skillIds.push(skillId)
  }

  return { ownerId, workspaceId, agentId, skillIds }
}

async function cleanupSeeded(seeded: Seeded) {
  for (const skillId of seeded.skillIds) {
    await testDb.db.delete(schema.skill).where(eq(schema.skill.id, skillId))
  }
  await testDb.db
    .delete(schema.agent)
    .where(eq(schema.agent.id, seeded.agentId))
  await testDb.db
    .delete(schema.member)
    .where(eq(schema.member.userId, seeded.ownerId))
  await testDb.db
    .delete(schema.organization)
    .where(eq(schema.organization.id, seeded.workspaceId))
  await testDb.db.delete(schema.user).where(eq(schema.user.id, seeded.ownerId))
}

describe('skill assignment filtering by allowed_skills (integration)', () => {
  /** Uses @garden/db/testing so missing Postgres fails setup instead of skipping checks. */
  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation((connectionString) => {
      if (connectionString !== testDb.databaseUrl) {
        throw new Error('Expected the suite-owned database connection')
      }
      return testDb.db
    })
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('restricts assigned skills to the allowed slug list', async () => {
    const seeded = await seedBase({
      full_access: false,
      allowed_skills: ['pdf'],
      allowed_connectors: [],
      allowed_tools: [],
      approval_overrides: {},
    })
    try {
      const rows = await loadRuntimeSkillAssignments(
        {
          bucket: {} as unknown as R2Bucket,
          databaseUrl: testDb.databaseUrl,
        },
        {
          kind: 'target',
          workspaceId: seeded.workspaceId,
          target: agentSkillTarget(seeded.agentId),
        },
      )
      expect(rows.map((row) => row.slug).sort()).toEqual(['pdf'])
    } finally {
      await cleanupSeeded(seeded)
    }
  })

  it('returns all assigned skills for full-access agents', async () => {
    const seeded = await seedBase({
      full_access: true,
      allowed_skills: [],
      allowed_connectors: [],
      allowed_tools: [],
      approval_overrides: {},
    })
    try {
      const rows = await loadRuntimeSkillAssignments(
        {
          bucket: {} as unknown as R2Bucket,
          databaseUrl: testDb.databaseUrl,
        },
        {
          kind: 'target',
          workspaceId: seeded.workspaceId,
          target: agentSkillTarget(seeded.agentId),
        },
      )
      expect(rows.map((row) => row.slug).sort()).toEqual(['pdf', 'xlsx'])
    } finally {
      await cleanupSeeded(seeded)
    }
  })
})
