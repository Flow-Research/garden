import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { agentSkillTarget } from '@garden/core/skills'
import { loadRuntimeSkillAssignments } from './skills'
import { isTestDbReachable } from './test-db'

vi.mock('agents/skills', () => ({
  r2: () => ({
    id: 'mock',
    fingerprint: 'mock',
    list: async () => [],
    load: async () => null,
  }),
}))

const TEST_DB_URL =
  process.env.GARDEN_TEST_DATABASE_URL ??
  'postgres://garden@localhost:5433/garden_test'

const DB_REACHABLE = await isTestDbReachable(TEST_DB_URL)

let pool: Pool
let db: ReturnType<typeof drizzle<typeof schema>>

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

  await db.insert(schema.user).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    name: 'Owner',
  })
  await db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Skills workspace',
    slug: `skills-${workspaceId}`,
  })
  await db.insert(schema.member).values({
    organizationId: workspaceId,
    userId: ownerId,
    role: 'owner',
  })
  await db.insert(schema.agent).values({
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
    await db.insert(schema.skill).values({
      id: skillId,
      workspaceId,
      name,
      slug,
    })
    await db.insert(schema.skillAssignment).values({
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
    await db.delete(schema.skill).where(eq(schema.skill.id, skillId))
  }
  await db.delete(schema.agent).where(eq(schema.agent.id, seeded.agentId))
  await db
    .delete(schema.member)
    .where(eq(schema.member.userId, seeded.ownerId))
  await db
    .delete(schema.organization)
    .where(eq(schema.organization.id, seeded.workspaceId))
  await db.delete(schema.user).where(eq(schema.user.id, seeded.ownerId))
}

describe.skipIf(!DB_REACHABLE)(
  'skill assignment filtering by allowed_skills (integration)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL })
    db = drizzle(pool, { schema })
  })

  afterAll(async () => {
    await pool.end()
  }, 30_000)

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
          databaseUrl: TEST_DB_URL,
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
          databaseUrl: TEST_DB_URL,
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
