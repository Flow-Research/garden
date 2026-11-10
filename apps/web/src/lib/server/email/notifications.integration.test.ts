// @vitest-environment node
import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Result } from 'better-result'
import * as schema from '@garden/db/schema'
import type { GardenDatabase } from '@garden/db'
import type * as RuntimeDbModule from '@garden/db/runtime'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  explicitMemberMentionIds,
  upsertChatMentionInbox,
  upsertIssueMentionInbox,
  upsertIssueAssignmentInbox,
  upsertWaitingForInputInbox,
  upsertPermissionRequestInbox,
} from '@garden/db/inbox'
import { createIssue, postIssueComment } from '@garden/server/issues/server'
import {
  dispatchNotificationEmails,
  NotificationEmailError,
  type NotificationEmailSender,
} from './notifications'

const env = {
  RESEND_API_KEY: 're_test',
  BETTER_AUTH_URL: 'https://garden.example.com',
}
const now = new Date('2026-11-10T12:00:00.000Z')

const serviceDatabases = vi.hoisted(() => new Map<string, GardenDatabase>())

// Reuse the testcontainer client for service calls so no second pool survives
// container teardown. Queries and transactions still execute against Postgres.
vi.mock('@garden/db/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeDbModule>()
  return {
    ...actual,
    getPooledDb: (url: string) =>
      serviceDatabases.get(url) ?? actual.getPooledDb(url),
  }
})

describe('workspace notification email delivery', () => {
  let testDb: TestDb
  let workspaceId: string
  let authorId: string
  let recipientId: string
  let issueId: string
  let agentId: string
  const send = vi.fn<NotificationEmailSender>(async () =>
    Result.ok({ id: 'email-1' }),
  )
  const mention = (id: string) => `[@Person](mention://member/${id})`

  beforeAll(async () => {
    testDb = await startTestDb()
    serviceDatabases.set(testDb.databaseUrl, testDb.db)
  })
  afterAll(async () => {
    await testDb?.cleanup()
  })
  beforeEach(async () => {
    vi.restoreAllMocks()
    await testDb.db.delete(schema.inboxItem)
    workspaceId = randomUUID()
    authorId = randomUUID()
    recipientId = randomUUID()
    issueId = randomUUID()
    agentId = randomUUID()
    send
      .mockReset()
      .mockImplementation(async () => Result.ok({ id: 'email-1' }))
    await testDb.db
      .insert(schema.organization)
      .values({ id: workspaceId, name: '<Garden & team>', slug: workspaceId })
    await testDb.db.insert(schema.user).values([
      { id: authorId, name: 'Author', email: `${authorId}@example.com` },
      { id: recipientId, name: 'Person', email: `${recipientId}@example.com` },
    ])
    await testDb.db.insert(schema.member).values([
      { organizationId: workspaceId, userId: authorId, role: 'owner' },
      { organizationId: workspaceId, userId: recipientId, role: 'member' },
    ])
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: authorId,
      name: 'Agent',
    })
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      number: 1,
      title: '<script>alert("x")</script>',
      createdBy: authorId,
      assigneeType: 'user',
      assigneeId: recipientId,
    })
  })

  const dispatch = () =>
    dispatchNotificationEmails({ db: testDb.db, env, send, now })
  const items = () =>
    testDb.db
      .select()
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.workspaceId, workspaceId))
  const assignment = () =>
    upsertIssueAssignmentInbox({
      db: testDb.db,
      workspaceId,
      issueId,
      actorType: 'member',
      actorId: authorId,
    })

  it('parses stable explicit ids, escaped labels, and duplicates without matching agents or plain text', () => {
    expect(
      explicitMemberMentionIds(
        `${mention(recipientId)} ${mention(recipientId)} [@A\\] B](mention://member/${authorId}) @Person [@Agent](mention://agent/${agentId}) [@All](mention://all/all)`,
      ),
    ).toEqual([recipientId, authorId])
  })

  it('emails newly created assignment items once, with escaped HTML and workspace links', async () => {
    await assignment()
    expect((await items())[0]?.emailDelivery).toEqual({ kind: 'pending' })
    expect(await dispatch()).toMatchObject({ status: 'ok', value: { sent: 1 } })
    const [payload, key] = send.mock.calls[0] ?? []
    expect(payload?.html).toContain('&lt;script&gt;')
    expect(payload?.html).not.toContain('<script>')
    expect(payload?.text).toContain(
      `/tasks/${issueId}?workspace_id=${workspaceId}`,
    )
    expect(key).toBe(`inbox/${(await items())[0]?.id}`)
    await assignment()
    await dispatch()
    expect(send).toHaveBeenCalledTimes(1)
    expect((await items())[0]?.emailDelivery).toEqual({
      kind: 'sent',
      providerId: 'email-1',
    })
  })

  it('creates assignment and description mentions through the real issue creation service', async () => {
    const result = await createIssue({
      databaseUrl: testDb.databaseUrl,
      workspaceId,
      createdBy: authorId,
      title: 'New issue',
      assigneeType: 'user',
      assigneeId: recipientId,
      description: mention(recipientId),
    })
    expect(result.isOk()).toBe(true)
    expect((await items()).map((item) => item.type).sort()).toEqual([
      'issue_assigned',
      'mentioned',
    ])
    await dispatch()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('creates comment mentions through the real comment service without recipient polling', async () => {
    const duplicateNameId = randomUUID()
    await testDb.db.insert(schema.user).values({
      id: duplicateNameId,
      name: 'Person',
      email: `${duplicateNameId}@example.com`,
    })
    await testDb.db.insert(schema.member).values({
      organizationId: workspaceId,
      userId: duplicateNameId,
      role: 'member',
    })
    const result = await postIssueComment({
      databaseUrl: testDb.databaseUrl,
      workspaceId,
      issueIdOrIdentifier: issueId,
      authorUserId: authorId,
      body: mention(recipientId),
      issueRunEnv: { HYPERDRIVE: { connectionString: testDb.databaseUrl } },
    })
    expect(result.isOk()).toBe(true)
    const [comment] = await testDb.db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.issueId, issueId))
    expect(comment?.mentions).toMatchObject({ users: [recipientId] })
    const [item] = await items()
    expect(item).toMatchObject({
      recipientId,
      type: 'mentioned',
      emailDelivery: { kind: 'pending' },
    })
    await upsertIssueMentionInbox({
      db: testDb.db,
      workspaceId,
      issueId,
      commentId: result.match({
        ok: (posted) => posted.comment_id,
        err: () => '',
      }),
      actorType: 'member',
      actorId: authorId,
      content: `Edited ${mention(recipientId)}`,
    })
    await dispatch()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends input and approval items created by their shared writers', async () => {
    await upsertWaitingForInputInbox({
      db: testDb.db,
      workspaceId,
      issueId,
      runId: randomUUID(),
      agentId,
    })
    const requestId = randomUUID()
    await testDb.db.insert(schema.permissionRequest).values({
      id: requestId,
      agentId,
      issueId,
      kind: 'connector_write',
      status: 'pending',
    })
    await upsertPermissionRequestInbox({
      db: testDb.db,
      workspaceId,
      requestId,
    })
    expect((await items()).map((item) => item.type)).toContain(
      'waiting_for_input',
    )
    expect((await items()).map((item) => item.type)).toContain(
      'review_requested',
    )
    await dispatch()
    expect(send.mock.calls.length).toBe((await items()).length)
  })

  it('suppresses self, non-workspace and inaccessible Team mentions', async () => {
    const outsiderId = randomUUID()
    await testDb.db.insert(schema.user).values({
      id: outsiderId,
      name: 'Outside',
      email: `${outsiderId}@example.com`,
    })
    const teamId = randomUUID()
    await testDb.db.insert(schema.team).values({
      id: teamId,
      workspaceId,
      name: 'Private team',
      ownerUserId: authorId,
      createdBy: authorId,
    })
    await testDb.db
      .update(schema.issue)
      .set({ teamId })
      .where(eq(schema.issue.id, issueId))
    await upsertIssueMentionInbox({
      db: testDb.db,
      workspaceId,
      issueId,
      actorType: 'member',
      actorId: authorId,
      content: [authorId, recipientId, outsiderId].map(mention).join(' '),
    })
    expect(await items()).toHaveLength(0)
  })

  it('keeps private chat content out of notices and deduplicates recovered turns', async () => {
    const args = {
      db: testDb.db,
      workspaceId,
      threadId: randomUUID(),
      messageId: randomUUID(),
      actorId: authorId,
      content: `TOP SECRET ${mention(recipientId)}`,
    }
    await upsertChatMentionInbox(args)
    await upsertChatMentionInbox(args)
    await dispatch()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0].text).not.toContain('TOP SECRET')
    expect(send.mock.calls[0]?.[0].text).toContain(
      `/inbox?workspace_id=${workspaceId}`,
    )
  })

  it('retains identical snapshot and key after an ambiguous provider failure', async () => {
    await assignment()
    send.mockResolvedValueOnce(
      Result.err(
        new NotificationEmailError({ message: 'network', retryable: true }),
      ),
    )
    expect(await dispatch()).toMatchObject({ value: { retryPending: 1 } })
    await testDb.db
      .update(schema.inboxItem)
      .set({ title: 'Changed title' })
      .where(eq(schema.inboxItem.workspaceId, workspaceId))
    await dispatch()
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect((await items())[0]?.emailDelivery.kind).toBe('sent')
  })

  it('rechecks access after queueing and skips recipients removed from workspace', async () => {
    await assignment()
    await testDb.db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspaceId),
          eq(schema.member.userId, recipientId),
        ),
      )
    await dispatch()
    expect(send).not.toHaveBeenCalled()
    expect((await items())[0]?.emailDelivery.kind).toBe('skipped')
  })

  it('does not resend after the provider idempotency key expires', async () => {
    await assignment()
    send.mockResolvedValueOnce(
      Result.err(
        new NotificationEmailError({ message: 'network', retryable: true }),
      ),
    )
    await dispatch()
    await dispatchNotificationEmails({
      db: testDb.db,
      env,
      send,
      now: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect((await items())[0]?.emailDelivery).toEqual({
      kind: 'failed',
      reason: 'idempotency_window_expired',
    })
  })

  it('does not mutate pending records when email is unconfigured', async () => {
    await assignment()
    expect(
      await dispatchNotificationEmails({ db: testDb.db, env: {} }),
    ).toMatchObject({ value: { kind: 'unconfigured' } })
    expect((await items())[0]?.emailDelivery.kind).toBe('pending')
  })

  it('queues only newly added recipients when a description changes', async () => {
    const thirdId = randomUUID()
    await testDb.db
      .insert(schema.user)
      .values({ id: thirdId, name: 'Third', email: `${thirdId}@example.com` })
    await testDb.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: thirdId, role: 'member' })
    const args = {
      db: testDb.db,
      workspaceId,
      issueId,
      actorType: 'member' as const,
      actorId: authorId,
    }
    await upsertIssueMentionInbox({ ...args, content: mention(recipientId) })
    await dispatch()
    await upsertIssueMentionInbox({
      ...args,
      content: `${mention(recipientId)} ${mention(thirdId)}`,
    })
    await dispatch()
    expect(send).toHaveBeenCalledTimes(2)
    expect(new Set(send.mock.calls.map(([payload]) => payload.to))).toEqual(
      new Set([`${recipientId}@example.com`, `${thirdId}@example.com`]),
    )
  })

  it('preserves a single immutable request across overlapping dispatchers', async () => {
    await assignment()
    send.mockResolvedValueOnce(
      Result.err(
        new NotificationEmailError({ message: 'network', retryable: true }),
      ),
    )
    await dispatch()
    await Promise.all([dispatch(), dispatch()])
    expect(send.mock.calls.length).toBeGreaterThan(1)
    for (const call of send.mock.calls) expect(call).toEqual(send.mock.calls[0])
    expect((await items())[0]?.emailDelivery.kind).toBe('sent')
  })

  it('marks a permanent rejection failed and continues with the next item', async () => {
    await assignment()
    await upsertIssueMentionInbox({
      db: testDb.db,
      workspaceId,
      issueId,
      actorType: 'member',
      actorId: authorId,
      content: mention(recipientId),
    })
    send.mockResolvedValueOnce(
      Result.err(
        new NotificationEmailError({
          message: 'invalid recipient',
          retryable: false,
        }),
      ),
    )
    expect(await dispatch()).toMatchObject({
      value: { sent: 1, failed: 1, retryPending: 0 },
    })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('rechecks Team visibility before sending queued assignments', async () => {
    await assignment()
    const teamId = randomUUID()
    await testDb.db.insert(schema.team).values({
      id: teamId,
      workspaceId,
      name: 'Restricted',
      ownerUserId: authorId,
      createdBy: authorId,
    })
    await testDb.db
      .update(schema.issue)
      .set({ teamId })
      .where(eq(schema.issue.id, issueId))
    await dispatch()
    expect(send).not.toHaveBeenCalled()
    expect((await items())[0]?.emailDelivery.kind).toBe('skipped')
  })

  it('uses the actual Resend SDK with the durable key at the HTTP boundary', async () => {
    await assignment()
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await dispatchNotificationEmails({ db: testDb.db, env, now })
    expect(result).toMatchObject({ value: { sent: 1 } })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails')
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Idempotency-Key'),
    ).toBe(`inbox/${(await items())[0]?.id}`)
    expect((await items())[0]?.emailDelivery).toEqual({
      kind: 'sent',
      providerId: 'resend-id',
    })
    fetch.mockRestore()
  })

  it.each([
    { status: 429, name: 'rate_limit_exceeded', expected: 'sending' },
    { status: 422, name: 'validation_error', expected: 'failed' },
  ])(
    'classifies Resend HTTP $status without failing the original write',
    async ({ status, name, expected }) => {
      await assignment()
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            name,
            statusCode: status,
            message: 'Simulated rejection',
          }),
          {
            status,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      expect(
        (await dispatchNotificationEmails({ db: testDb.db, env, now })).isOk(),
      ).toBe(true)
      expect((await items())[0]?.emailDelivery.kind).toBe(expected)
    },
  )
})
