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
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { invokeRouteHandler } from '@/test/route-handler'
import type { AppRequestContext } from '@/lib/server/context'
import { Route } from './webhook'
import { TEST_DB_HOOK_TIMEOUT_MS, seedWorkspace } from '../teams/-fixtures'

const SECRET = 'garden-webhook-test-secret'

type Published = {
  type: string
  payload: Record<string, unknown>
  committedIssueStatus: string | null
  committedCommentIds: string[]
}

const harness = vi.hoisted(() => ({
  published: [] as unknown[],
  observe: async (_envelope: unknown): Promise<void> => {},
}))

const runService = vi.hoisted(() => ({
  cancelIssueRun: vi.fn(),
  startIssueRun: vi.fn(),
}))

vi.mock('@/lib/server/env', () => ({
  appEnv: {
    GITHUB_WEBHOOK_SECRET: 'garden-webhook-test-secret',
    WORKSPACE_REALTIME: {
      idFromName: (name: string) => name,
      get: () => ({
        publish: (envelope: unknown) => harness.observe(envelope),
      }),
    },
  },
}))

vi.mock('@garden/server/issues/run-service', () => runService)

describe('POST /api/github/webhook (integration)', () => {
  let testDb: TestDb
  let workspaceId: string
  let ownerId: string
  let agentId: string
  let pending: Promise<unknown>[] = []

  beforeAll(async () => {
    testDb = await startTestDb()
    const fixture = await seedWorkspace(testDb)
    workspaceId = fixture.workspaceId
    ownerId = fixture.ownerId
    agentId = fixture.activeAgentId
    await testDb.db.insert(schema.githubAppInstallation).values({
      workspaceId,
      installationId: '99',
      accountLogin: 'Flow-Research',
    })
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  beforeEach(() => {
    harness.published = []
    pending = []
    runService.cancelIssueRun.mockReset()
    runService.cancelIssueRun.mockResolvedValue(Result.ok(undefined))
    // The realtime hub is a separate actor: it reads through its own pool
    // connection, so it sees only state that has already committed.
    harness.observe = async (envelope) => {
      const event = envelope as {
        type: string
        payload: Record<string, unknown>
      }
      const issueId = (event.payload.issue_id ??
        (event.payload.issue as { id?: string } | undefined)?.id) as string
      const issueRows = await testDb.pool.query<{ status: string }>(
        'select status from issue where id = $1',
        [issueId],
      )
      const commentRows = await testDb.pool.query<{ id: string }>(
        'select id from issue_comment where issue_id = $1',
        [issueId],
      )
      harness.published.push({
        type: event.type,
        payload: event.payload,
        committedIssueStatus: issueRows.rows[0]?.status ?? null,
        committedCommentIds: commentRows.rows.map((row) => row.id),
      } satisfies Published)
    }
  })

  let issueNumber = 0

  async function seedLinkedIssue(status = 'in_progress') {
    issueNumber += 1
    const issueId = randomUUID()
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      number: issueNumber,
      title: 'Original title',
      description: 'Original body',
      status,
      createdBy: ownerId,
      assigneeType: 'agent',
      assigneeId: agentId,
    })
    await testDb.db.insert(schema.issueSourceBinding).values({
      id: randomUUID(),
      workspaceId,
      issueId,
      connectorId: 'github',
      sourceKind: 'issue',
      externalId: `Flow-Research/garden/issues/${issueNumber}`,
    })
    return { issueId, githubNumber: issueNumber }
  }

  function issuePayload(args: {
    githubNumber: number
    action: string
    title?: string
    updatedAt: string
  }) {
    return {
      action: args.action,
      installation: { id: 99 },
      repository: {
        name: 'garden',
        full_name: 'Flow-Research/garden',
        owner: { login: 'Flow-Research' },
      },
      issue: {
        number: args.githubNumber,
        title: args.title ?? 'Original title',
        body: 'Original body',
        state: args.action === 'closed' ? 'closed' : 'open',
        updated_at: args.updatedAt,
      },
      sender: { type: 'User' },
    }
  }

  function commentPayload(args: {
    githubNumber: number
    action: string
    commentId: number
    body: string
    updatedAt: string
  }) {
    return {
      action: args.action,
      installation: { id: 99 },
      repository: {
        name: 'garden',
        full_name: 'Flow-Research/garden',
        owner: { login: 'Flow-Research' },
      },
      issue: { number: args.githubNumber },
      comment: {
        id: args.commentId,
        body: args.body,
        created_at: '2026-04-01T12:00:00Z',
        updated_at: args.updatedAt,
        user: { id: 1, login: 'octocat', type: 'User' },
      },
      sender: { type: 'User' },
    }
  }

  async function sign(body: string) {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    return `sha256=${Buffer.from(digest).toString('hex')}`
  }

  async function deliver(args: {
    payload: unknown
    deliveryId?: string | null
    event?: string
    signature?: string
  }) {
    const body = JSON.stringify(args.payload)
    const headers = new Headers({
      'content-type': 'application/json',
      'x-github-event': args.event ?? 'issues',
      'x-hub-signature-256': args.signature ?? (await sign(body)),
    })
    if (args.deliveryId !== null) {
      headers.set('x-github-delivery', args.deliveryId ?? randomUUID())
    }
    const request = new Request('https://garden.test/api/github/webhook', {
      method: 'POST',
      headers,
      body,
    })
    const context = {
      env: {},
      request,
      db: async () => testDb.db,
      close: async () => {},
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise)
      },
    } as unknown as AppRequestContext
    const response = await invokeRouteHandler(Route, 'POST', {
      context,
      request,
    })
    await Promise.all(pending)
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    }
  }

  async function readIssue(issueId: string) {
    const [row] = await testDb.db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, issueId))
    return row
  }

  it('runs Garden issue lifecycle effects when GitHub closes the issue', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    const runId = randomUUID()
    await testDb.db.insert(schema.issueRun).values({
      id: runId,
      workspaceId,
      issueId,
      agentId,
      hostName: 'test',
      status: 'running',
    })
    const inboxItemId = randomUUID()
    await testDb.db.insert(schema.inboxItem).values({
      id: inboxItemId,
      workspaceId,
      recipientType: 'member',
      recipientId: ownerId,
      itemKey: `issue_assigned:${issueId}`,
      type: 'issue_assigned',
      issueId,
      title: 'Assigned',
      activityAt: new Date(),
    })

    const response = await deliver({
      payload: issuePayload({
        githubNumber,
        action: 'closed',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })

    expect(response).toEqual({
      status: 200,
      body: {
        ok: true,
        status: 'applied',
        fields: ['status'],
        issue_id: issueId,
      },
    })
    expect((await readIssue(issueId))?.status).toBe('done')
    const [inbox] = await testDb.db
      .select()
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.id, inboxItemId))
    expect(inbox).toMatchObject({ archived: true, read: true })
    expect(runService.cancelIssueRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId,
        runId,
        reason: 'issue_changed',
        actor: { type: 'system', id: 'github-webhook' },
      }),
    )
    expect(harness.published).toEqual([
      expect.objectContaining({
        type: 'issue:updated',
        payload: {
          issue: expect.objectContaining({ id: issueId, status: 'done' }),
        },
        committedIssueStatus: 'done',
      }),
    ])
  })

  it('treats a redelivered delivery id as a no-op', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    const payload = issuePayload({
      githubNumber,
      action: 'edited',
      title: 'Title from GitHub',
      updatedAt: '2026-04-01T12:00:00Z',
    })

    const first = await deliver({ payload, deliveryId: 'delivery-replay' })
    expect(first.body).toMatchObject({ status: 'applied', fields: ['title'] })

    await testDb.db
      .update(schema.issue)
      .set({ title: 'Renamed in Garden' })
      .where(eq(schema.issue.id, issueId))
    harness.published = []

    const replay = await deliver({ payload, deliveryId: 'delivery-replay' })
    expect(replay).toEqual({
      status: 200,
      body: { ok: true, status: 'duplicate' },
    })
    expect((await readIssue(issueId))?.title).toBe('Renamed in Garden')
    expect(harness.published).toEqual([])
  })

  it('ignores a delivery older than one already applied', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()

    const newer = await deliver({
      payload: issuePayload({
        githubNumber,
        action: 'edited',
        title: 'Newer title',
        updatedAt: '2026-04-01T12:05:00Z',
      }),
    })
    expect(newer.body).toMatchObject({ status: 'applied' })

    const olderDeliveryId = randomUUID()
    const older = await deliver({
      deliveryId: olderDeliveryId,
      payload: issuePayload({
        githubNumber,
        action: 'closed',
        title: 'Older title',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(older).toEqual({ status: 200, body: { ok: true, status: 'stale' } })
    expect(await readIssue(issueId)).toMatchObject({
      title: 'Newer title',
      status: 'in_progress',
    })
    expect(runService.cancelIssueRun).not.toHaveBeenCalled()

    const redelivered = await deliver({
      deliveryId: olderDeliveryId,
      payload: issuePayload({
        githubNumber,
        action: 'closed',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(redelivered.body).toEqual({ ok: true, status: 'duplicate' })
  })

  it('lets a delivery whose apply failed be redelivered', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    await testDb.pool.query(
      `alter table issue add constraint webhook_test_reject check (title <> 'Rejected title')`,
    )
    const payload = issuePayload({
      githubNumber,
      action: 'edited',
      title: 'Rejected title',
      updatedAt: '2026-04-01T12:00:00Z',
    })

    const failed = await deliver({ payload, deliveryId: 'delivery-retry' })
    await testDb.pool.query(
      'alter table issue drop constraint webhook_test_reject',
    )
    expect(failed.status).toBe(503)
    expect(harness.published).toEqual([])

    const retried = await deliver({ payload, deliveryId: 'delivery-retry' })
    expect(retried.body).toMatchObject({ status: 'applied', fields: ['title'] })
    expect((await readIssue(issueId))?.title).toBe('Rejected title')
  })

  it('publishes comment events after the comment commits and keeps deleted comments deleted', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    const created = await deliver({
      event: 'issue_comment',
      payload: commentPayload({
        githubNumber,
        action: 'created',
        commentId: 555,
        body: 'hello from GitHub',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(created.body).toMatchObject({
      status: 'applied',
      comment_action: 'created',
    })
    const commentId = created.body.comment_id as string
    const [comment] = await testDb.db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.id, commentId))
    expect(comment).toMatchObject({
      authorType: 'connector',
      authorId: null,
      body: 'hello from GitHub',
      externalCommentId: '555',
    })
    expect(harness.published).toEqual([
      {
        type: 'comment:created',
        payload: {
          issue_id: issueId,
          comment_id: commentId,
          team_id: null,
          assignee_id: agentId,
        },
        committedIssueStatus: 'in_progress',
        committedCommentIds: [commentId],
      },
    ])

    const deleted = await deliver({
      event: 'issue_comment',
      payload: commentPayload({
        githubNumber,
        action: 'deleted',
        commentId: 555,
        body: 'hello from GitHub',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(deleted.body).toMatchObject({
      status: 'applied',
      comment_action: 'deleted',
    })

    const lateEdit = await deliver({
      event: 'issue_comment',
      payload: commentPayload({
        githubNumber,
        action: 'edited',
        commentId: 555,
        body: 'late edit',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(lateEdit.body).toEqual({ ok: true, status: 'stale' })
    const remaining = await testDb.db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.issueId, issueId))
    expect(remaining).toEqual([])
  })

  it('rejects unsigned and unidentified deliveries before touching data', async () => {
    const { githubNumber } = await seedLinkedIssue()
    const payload = issuePayload({
      githubNumber,
      action: 'closed',
      updatedAt: '2026-04-01T12:00:00Z',
    })

    const badSignature = await deliver({ payload, signature: 'sha256=00' })
    expect(badSignature.status).toBe(401)

    const missingDelivery = await deliver({ payload, deliveryId: null })
    expect(missingDelivery.status).toBe(400)
    expect(harness.published).toEqual([])
  })
})
