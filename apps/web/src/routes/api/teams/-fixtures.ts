import { randomUUID } from 'node:crypto'
import type { TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import type { AppRequestContext } from '@/lib/server/context'

export const TEST_DB_HOOK_TIMEOUT_MS = 120_000

export type FakeRole = 'owner' | 'admin' | 'member'

export interface WorkspaceFixture {
  workspaceId: string
  ownerId: string
  adminId: string
  memberId: string
  otherId: string
  outsiderId: string
  activeAgentId: string
  archivedAgentId: string
}

export function handlerFor(route: unknown, method: string) {
  const handlers = (
    route as {
      options: {
        server?: { handlers?: Record<string, (...args: never[]) => unknown> }
      }
    }
  ).options.server?.handlers
  const handler = handlers?.[method]
  if (typeof handler !== 'function') {
    throw new Error(`Expected ${method} handler`)
  }
  return handler as (args: {
    context: AppRequestContext
    request: Request
    params: Record<string, string>
    pathname: string
    next: () => { isNext: boolean; context: undefined }
  }) => Promise<Response>
}

/**
 * Builds a request context over the test database. Session and Better Auth's
 * `hasPermission` primitive are stubbed so tests exercise routes, access
 * helpers, and SQL against real rows; the role matrix is driven by `role`.
 */
export function makeContext(args: {
  testDb: TestDb
  userId: string
  role: FakeRole
  request: Request
}): AppRequestContext {
  return {
    env: {} as AppRequestContext['env'],
    request: args.request,
    db: async () => args.testDb.db,
    close: async () => {},
    auth: {
      getAuth: async () =>
        ({
          api: {
            hasPermission: async () => ({ success: args.role !== 'member' }),
          },
        }) as unknown as Awaited<
          ReturnType<AppRequestContext['auth']['getAuth']>
        >,
      getSession: async () =>
        ({
          user: { id: args.userId },
          session: { activeOrganizationId: null },
        }) as Awaited<ReturnType<AppRequestContext['auth']['getSession']>>,
      getCachedSession: () => undefined,
    },
    waitUntil: () => {},
  }
}

export async function seedUser(
  testDb: TestDb,
  workspaceId: string | null,
  role: FakeRole,
) {
  const userId = randomUUID()
  await testDb.db.insert(schema.user).values({
    id: userId,
    email: `${userId}@example.com`,
    name: `User ${role}`,
  })
  if (workspaceId) {
    await testDb.db.insert(schema.member).values({
      organizationId: workspaceId,
      userId,
      role,
    })
  }
  return userId
}

export async function seedWorkspace(testDb: TestDb): Promise<WorkspaceFixture> {
  const workspaceId = randomUUID()
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Teams test workspace',
    slug: `teams-${workspaceId}`,
  })
  const ownerId = await seedUser(testDb, workspaceId, 'owner')
  const adminId = await seedUser(testDb, workspaceId, 'admin')
  const memberId = await seedUser(testDb, workspaceId, 'member')
  const otherId = await seedUser(testDb, workspaceId, 'member')
  const outsiderId = await seedUser(testDb, null, 'member')
  const activeAgentId = randomUUID()
  const archivedAgentId = randomUUID()
  await testDb.db.insert(schema.agent).values([
    {
      id: activeAgentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Active agent',
      status: 'active',
    },
    {
      id: archivedAgentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Archived agent',
      status: 'archived',
    },
  ])
  return {
    workspaceId,
    ownerId,
    adminId,
    memberId,
    otherId,
    outsiderId,
    activeAgentId,
    archivedAgentId,
  }
}

export async function seedTeamRow(
  testDb: TestDb,
  args: {
    workspaceId: string
    name: string
    ownerUserId: string
    memberUserIds?: string[]
  },
) {
  const teamId = randomUUID()
  await testDb.db.insert(schema.team).values({
    id: teamId,
    workspaceId: args.workspaceId,
    name: args.name,
    ownerUserId: args.ownerUserId,
    createdBy: args.ownerUserId,
  })
  const memberUserIds = [
    args.ownerUserId,
    ...(args.memberUserIds ?? []).filter(
      (userId) => userId !== args.ownerUserId,
    ),
  ]
  await testDb.db.insert(schema.teamMember).values(
    memberUserIds.map((userId) => ({
      id: randomUUID(),
      teamId,
      workspaceId: args.workspaceId,
      userId,
      createdBy: args.ownerUserId,
    })),
  )
  return teamId
}

export async function seedTeamIssue(
  testDb: TestDb,
  args: {
    workspaceId: string
    teamId: string | null
    number: number
    createdBy: string
    assigneeId?: string
  },
) {
  const issueId = randomUUID()
  await testDb.db.insert(schema.issue).values({
    id: issueId,
    workspaceId: args.workspaceId,
    teamId: args.teamId,
    number: args.number,
    title: `Team issue ${args.number}`,
    createdBy: args.createdBy,
    assigneeType: args.assigneeId ? 'user' : null,
    assigneeId: args.assigneeId ?? null,
  })
  return issueId
}

export function jsonRequest(
  url: string,
  workspaceId: string,
  method: string,
  body?: unknown,
) {
  return new Request(url, {
    method,
    headers: {
      'X-Workspace-ID': workspaceId,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export function invocation(
  context: AppRequestContext,
  request: Request,
  params: Record<string, string>,
  pathname: string,
) {
  return {
    context,
    request,
    params,
    pathname,
    next: () => ({ isNext: true as const, context: undefined }),
  }
}
