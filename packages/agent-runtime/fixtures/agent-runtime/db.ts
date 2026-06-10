import process from 'node:process'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { eq } from 'drizzle-orm'
import * as schema from '../../../../packages/db/src/schema/index.ts'

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export async function resolveFixtureWorkspace() {
  const db = drizzle(requiredEnv('DATABASE_URL'), { schema })
  const [workspace] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.name, process.env.GARDEN_FIXTURE_WORKSPACE ?? 'Dev'))
    .limit(1)
  if (!workspace) throw new Error('Fixture workspace not found')

  const [member] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, workspace.id))
    .limit(1)
  if (!member) throw new Error('Fixture workspace has no member')

  return { userId: member.userId, workspaceId: workspace.id }
}
