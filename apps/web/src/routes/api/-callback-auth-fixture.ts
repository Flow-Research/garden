import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import type { TestDb } from '@garden/db/testing'
import { createBetterAuth } from '@/lib/auth/instance'
import type { AppEnv } from '@/lib/server/env'

export type WorkspaceRole = 'owner' | 'admin' | 'member'
export const authTestOrigin = 'http://localhost:3000'
// Reuse the established Postgres lifecycle budget from agent-proposal-request.test.
export const TEST_DB_HOOK_TIMEOUT_MS = 120_000

/** The callback authority tests use isolated auth/DB bindings and disable analytics egress. */
export function workspaceTestEnv(databaseUrl: string): AppEnv {
  return {
    DATABASE_URL: databaseUrl,
    HYPERDRIVE: { connectionString: databaseUrl },
    BETTER_AUTH_SECRET:
      'workspace-authority-test-secret-at-least-32-characters',
    BETTER_AUTH_URL: authTestOrigin,
    ENVIRONMENT: 'test',
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
  } as AppEnv
}

/**
 * Exercise Garden's real auth adapter and role policy with isolated memberships
 * and signed session cookies. Mocked permission answers would miss policy drift.
 */
export async function seedWorkspaceActor(
  db: TestDb['db'],
  env: AppEnv,
  role: WorkspaceRole | null = 'member',
) {
  const auth = createBetterAuth(db, env)
  const response = await auth.api.signUpEmail({
    body: {
      email: `${randomUUID()}@example.com`,
      name: 'Workspace actor',
      password: 'isolated-test-password',
    },
    asResponse: true,
  })
  expect(response.status).toBe(200)
  const { user } = z
    .object({ user: z.object({ id: z.uuid() }) })
    .parse(await response.json())
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  expect(cookie).toContain('better-auth.session_token=')

  const workspaceId = randomUUID()
  await db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Authority workspace',
    slug: `authority-${workspaceId}`,
  })
  if (role) {
    await db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: workspaceId,
      userId: user.id,
      role,
      createdAt: new Date(),
    })
  }
  return { cookie, userId: user.id, workspaceId }
}
