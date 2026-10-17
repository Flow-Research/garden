import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { Route as MemberRoute } from './$memberId'
import { Route as MembersRoute } from '../members'
import {
  TEST_DB_HOOK_TIMEOUT_MS,
  handlerFor,
  invocation,
  makeContext,
  seedWorkspace,
} from '../../../teams/-fixtures'

async function membershipId(
  testDb: TestDb,
  workspaceId: string,
  userId: string,
) {
  const [row] = await testDb.db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        eq(schema.member.userId, userId),
      ),
    )
    .limit(1)
  if (!row) throw new Error('membership missing')
  return row.id
}

describe('member GitHub identity (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('lets a member self-link and unlink, and hydrates list reads', async () => {
    const fixture = await seedWorkspace(testDb)
    const memberRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.memberId,
    )

    const linkRequest = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '12345',
          github_login: 'garden-member',
        }),
      },
    )
    const linkResponse = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: linkRequest,
        }),
        linkRequest,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(linkResponse.status).toBe(200)
    const linked = (await linkResponse.json()) as {
      github_user_id: string | null
      github_login: string | null
    }
    expect(linked).toMatchObject({
      github_user_id: '12345',
      github_login: 'garden-member',
    })

    const listRequest = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members`,
    )
    const listContext = makeContext({
      testDb,
      userId: fixture.ownerId,
      role: 'owner',
      request: listRequest,
    })
    listContext.auth.getAuth = async () =>
      ({
        api: {
          listMembers: async () => ({
            members: [
              {
                id: memberRowId,
                organizationId: fixture.workspaceId,
                userId: fixture.memberId,
                role: 'member',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                user: {
                  name: 'Member',
                  email: 'member@example.com',
                  image: null,
                },
              },
            ],
          }),
          hasPermission: async () => ({ success: true }),
        },
      }) as never

    const listResponse = await handlerFor(MembersRoute, 'GET')(
      invocation(
        listContext,
        listRequest,
        { id: fixture.workspaceId },
        '/api/workspaces/$id/members',
      ),
    )
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as Array<{
      id: string
      github_user_id: string | null
      github_login: string | null
    }>
    expect(listed[0]).toMatchObject({
      id: memberRowId,
      github_user_id: '12345',
      github_login: 'garden-member',
    })

    const unlinkRequest = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: null,
          github_login: null,
        }),
      },
    )
    const unlinkResponse = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: unlinkRequest,
        }),
        unlinkRequest,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(unlinkResponse.status).toBe(200)
    const unlinked = (await unlinkResponse.json()) as {
      github_user_id: string | null
      github_login: string | null
    }
    expect(unlinked).toMatchObject({
      github_user_id: null,
      github_login: null,
    })
  })

  it('allows admins to edit another member and rejects duplicate identities', async () => {
    const fixture = await seedWorkspace(testDb)
    const memberRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.memberId,
    )
    const otherRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.otherId,
    )

    const adminLink = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '99',
          github_login: 'shared-login',
        }),
      },
    )
    const adminResponse = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.adminId,
          role: 'admin',
          request: adminLink,
        }),
        adminLink,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(adminResponse.status).toBe(200)

    const duplicate = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${otherRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '99',
          github_login: 'other-login',
        }),
      },
    )
    const duplicateResponse = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: duplicate,
        }),
        duplicate,
        { id: fixture.workspaceId, memberId: otherRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(duplicateResponse.status).toBe(409)
  })

  it('refreshes github_login on rename while keeping github_user_id', async () => {
    const fixture = await seedWorkspace(testDb)
    const memberRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.memberId,
    )

    const linkRequest = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '777',
          github_login: 'before-rename',
        }),
      },
    )
    const linked = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: linkRequest,
        }),
        linkRequest,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(linked.status).toBe(200)

    const renameRequest = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '777',
          github_login: 'after-rename',
        }),
      },
    )
    const renamed = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: renameRequest,
        }),
        renameRequest,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(renamed.status).toBe(200)
    const body = (await renamed.json()) as {
      github_user_id: string | null
      github_login: string | null
    }
    expect(body).toMatchObject({
      github_user_id: '777',
      github_login: 'after-rename',
    })
  })

  it('forbids a member from editing another member GitHub identity', async () => {
    const fixture = await seedWorkspace(testDb)
    const otherRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.otherId,
    )

    const request = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${otherRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '42',
          github_login: 'nope',
        }),
      },
    )
    const response = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request,
        }),
        request,
        { id: fixture.workspaceId, memberId: otherRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(response.status).toBe(403)
  })

  it('lets an admin unlink another member and frees the github_user_id for reclaim', async () => {
    const fixture = await seedWorkspace(testDb)
    const memberRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.memberId,
    )
    const otherRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.otherId,
    )

    const link = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '555',
          github_login: 'to-be-freed',
        }),
      },
    )
    expect(
      (
        await handlerFor(MemberRoute, 'PATCH')(
          invocation(
            makeContext({
              testDb,
              userId: fixture.adminId,
              role: 'admin',
              request: link,
            }),
            link,
            { id: fixture.workspaceId, memberId: memberRowId },
            '/api/workspaces/$id/members/$memberId',
          ),
        )
      ).status,
    ).toBe(200)

    const unlink = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: null,
          github_login: null,
        }),
      },
    )
    const unlinked = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.adminId,
          role: 'admin',
          request: unlink,
        }),
        unlink,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(unlinked.status).toBe(200)
    expect(await unlinked.json()).toMatchObject({
      github_user_id: null,
      github_login: null,
    })

    const reclaim = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${otherRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '555',
          github_login: 'reclaimed',
        }),
      },
    )
    const reclaimed = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: reclaim,
        }),
        reclaim,
        { id: fixture.workspaceId, memberId: otherRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(reclaimed.status).toBe(200)
    expect(await reclaimed.json()).toMatchObject({
      github_user_id: '555',
      github_login: 'reclaimed',
    })
  })

  it('allows distinct github_user_id values even when login strings match', async () => {
    const fixture = await seedWorkspace(testDb)
    const memberRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.memberId,
    )
    const otherRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.otherId,
    )

    const first = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '1001',
          github_login: 'same-login',
        }),
      },
    )
    expect(
      (
        await handlerFor(MemberRoute, 'PATCH')(
          invocation(
            makeContext({
              testDb,
              userId: fixture.memberId,
              role: 'member',
              request: first,
            }),
            first,
            { id: fixture.workspaceId, memberId: memberRowId },
            '/api/workspaces/$id/members/$memberId',
          ),
        )
      ).status,
    ).toBe(200)

    const second = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${otherRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '1002',
          github_login: 'same-login',
        }),
      },
    )
    const secondResponse = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.otherId,
          role: 'member',
          request: second,
        }),
        second,
        { id: fixture.workspaceId, memberId: otherRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(secondResponse.status).toBe(200)
  })

  it('rejects half-set github identity payloads at the API boundary', async () => {
    const fixture = await seedWorkspace(testDb)
    const memberRowId = await membershipId(
      testDb,
      fixture.workspaceId,
      fixture.memberId,
    )

    const request = new Request(
      `https://garden.test/api/workspaces/${fixture.workspaceId}/members/${memberRowId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_user_id: '9',
          github_login: null,
        }),
      },
    )
    const response = await handlerFor(MemberRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request,
        }),
        request,
        { id: fixture.workspaceId, memberId: memberRowId },
        '/api/workspaces/$id/members/$memberId',
      ),
    )
    expect(response.status).toBe(400)
  })
})
