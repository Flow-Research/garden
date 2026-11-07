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
import {
  parseGitHubIssueSnapshot,
  upsertGitHubIssue,
} from '@/lib/server/github-issue-sync'
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

  async function seedLinkedIssue(
    status = 'in_progress',
    githubNumber?: number,
    inWorkspace = workspaceId,
    assigneeId: string | null = agentId,
  ) {
    issueNumber += 1
    const issueId = randomUUID()
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId: inWorkspace,
      number: issueNumber,
      title: 'Original title',
      description: 'Original body',
      status,
      createdBy: ownerId,
      assigneeType: assigneeId ? 'agent' : null,
      assigneeId,
    })
    const number = githubNumber ?? issueNumber
    await testDb.db.insert(schema.issueSourceBinding).values({
      id: randomUUID(),
      workspaceId: inWorkspace,
      issueId,
      connectorId: 'github',
      sourceKind: 'issue',
      externalId: `Flow-Research/garden/issues/${number}`,
    })
    return { issueId, githubNumber: number }
  }

  function issuePayload(args: {
    githubNumber: number
    action: string
    title?: string
    updatedAt?: string
    sender?: { login: string; type: string }
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
      sender: args.sender ?? { login: 'octocat', type: 'User' },
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
      sender: { login: 'octocat', type: 'User' },
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
    const json = (await response.json()) as Record<string, unknown>
    const results = json.results as Record<string, unknown>[] | undefined
    return {
      status: response.status,
      json,
      body:
        results?.length === 1 ? (results[0] as Record<string, unknown>) : json,
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

    expect(response.status).toBe(200)
    expect(response.json).toEqual({
      ok: true,
      results: [{ status: 'applied', fields: ['status'], issue_id: issueId }],
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
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual({ status: 'duplicate' })
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
    expect(older.status).toBe(200)
    expect(older.body).toEqual({ status: 'stale' })
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
    expect(redelivered.body).toEqual({ status: 'duplicate' })
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
    expect(lateEdit.body).toEqual({ status: 'stale' })
    const remaining = await testDb.db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.issueId, issueId))
    expect(remaining).toEqual([])
  })

  it('applies closes from other bots and skips only the Garden App bot', async () => {
    const stale = await seedLinkedIssue()
    const closedByStale = await deliver({
      payload: issuePayload({
        githubNumber: stale.githubNumber,
        action: 'closed',
        updatedAt: '2026-04-01T12:00:00Z',
        sender: { login: 'github-actions[bot]', type: 'Bot' },
      }),
    })
    expect(closedByStale.body).toMatchObject({
      status: 'applied',
      fields: ['status'],
    })
    expect((await readIssue(stale.issueId))?.status).toBe('done')

    const echo = await seedLinkedIssue()
    const closedByGarden = await deliver({
      payload: issuePayload({
        githubNumber: echo.githubNumber,
        action: 'closed',
        updatedAt: '2026-04-01T12:00:00Z',
        sender: { login: 'garden-ai-dev[bot]', type: 'Bot' },
      }),
    })
    expect(closedByGarden.body).toEqual({
      status: 'skipped',
      skipped_reason: 'own_app_sender',
    })
    expect((await readIssue(echo.issueId))?.status).toBe('in_progress')
  })

  it('rejects a delivery without updated_at instead of stamping it now', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    const missing = await deliver({
      payload: issuePayload({ githubNumber, action: 'closed' }),
    })
    expect(missing.status).toBe(400)
    expect((await readIssue(issueId))?.status).toBe('in_progress')

    const later = await deliver({
      payload: issuePayload({
        githubNumber,
        action: 'edited',
        title: 'Edited after the bad delivery',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(later.body).toMatchObject({ status: 'applied', fields: ['title'] })
  })

  it('acknowledges a committed close when lifecycle effects throw', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    await testDb.db.insert(schema.issueRun).values({
      id: randomUUID(),
      workspaceId,
      issueId,
      agentId,
      hostName: 'test',
      status: 'running',
    })
    runService.cancelIssueRun.mockRejectedValue(new Error('run service down'))
    const payload = issuePayload({
      githubNumber,
      action: 'closed',
      updatedAt: '2026-04-01T12:00:00Z',
    })

    const response = await deliver({ payload, deliveryId: 'effects-throw' })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'applied' })
    expect(runService.cancelIssueRun).toHaveBeenCalled()
    expect((await readIssue(issueId))?.status).toBe('done')
  })

  it('keeps the issue scope live after unsupported actions like issues.deleted', async () => {
    const { issueId, githubNumber } = await seedLinkedIssue()
    for (const action of ['deleted', 'milestoned']) {
      const ignored = await deliver({
        payload: issuePayload({
          githubNumber,
          action,
          updatedAt: '2026-04-01T12:10:00Z',
        }),
      })
      expect(ignored).toMatchObject({
        status: 200,
        json: { ok: true, status: 'unsupported_action' },
      })
    }
    const ledger = await testDb.pool.query(
      'select 1 from github_webhook_delivery d join issue_source_binding b on b.id = d.binding_id where b.issue_id = $1',
      [issueId],
    )
    expect(ledger.rowCount).toBe(0)

    const edited = await deliver({
      payload: issuePayload({
        githubNumber,
        action: 'edited',
        title: 'Still syncing',
        updatedAt: '2026-04-01T12:00:00Z',
      }),
    })
    expect(edited.body).toMatchObject({ status: 'applied', fields: ['title'] })
    expect((await readIssue(issueId))?.title).toBe('Still syncing')
  })

  it('applies one delivery to every workspace linked to the installation', async () => {
    const other = await seedWorkspace(testDb)
    await testDb.db.insert(schema.githubAppInstallation).values({
      workspaceId: other.workspaceId,
      installationId: '99',
      accountLogin: 'Flow-Research',
    })
    const first = await seedLinkedIssue()
    const second = await seedLinkedIssue(
      'in_progress',
      first.githubNumber,
      other.workspaceId,
      null,
    )
    const deliveryId = randomUUID()
    const payload = issuePayload({
      githubNumber: first.githubNumber,
      action: 'closed',
      updatedAt: '2026-04-01T12:00:00Z',
    })

    const response = await deliver({ payload, deliveryId })
    expect(response.json.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'applied', issue_id: first.issueId }),
        expect.objectContaining({
          status: 'applied',
          issue_id: second.issueId,
        }),
      ]),
    )
    expect((await readIssue(first.issueId))?.status).toBe('done')
    expect((await readIssue(second.issueId))?.status).toBe('done')

    const replay = await deliver({ payload, deliveryId })
    expect(replay.json.results).toEqual([
      { status: 'duplicate' },
      { status: 'duplicate' },
    ])
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

  describe('linked repositories', () => {
    const LINKED_REPO_ID = 4242
    const LINKED_REPO = 'Flow-Research/sync-repo'
    let teamId: string
    let memberId: string

    beforeAll(async () => {
      const fixture = await testDb.db
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(eq(schema.member.organizationId, workspaceId))
      memberId = fixture.find((row) => row.userId !== ownerId)!.userId
      await testDb.db
        .update(schema.member)
        .set({ githubUserId: '501', githubLogin: 'member-gh' })
        .where(eq(schema.member.userId, memberId))
      teamId = randomUUID()
      await testDb.db.insert(schema.team).values({
        id: teamId,
        workspaceId,
        name: 'Sync team',
        ownerUserId: ownerId,
        createdBy: ownerId,
      })
      await testDb.db.insert(schema.teamRepository).values({
        workspaceId,
        teamId,
        githubRepoId: LINKED_REPO_ID,
        fullName: LINKED_REPO,
        linkedBy: ownerId,
        importState: 'ready',
      })
    })

    let linkedNumber = 1000

    function linkedPayload(args: {
      action: string
      number: number
      updatedAt: string
      repoId?: number
      fullName?: string
      state?: 'open' | 'closed'
      stateReason?: string | null
      assignees?: { id: number; login: string }[]
      labels?: string[]
      title?: string
      sender?: string
    }) {
      const fullName = args.fullName ?? LINKED_REPO
      const [owner, name] = fullName.split('/')
      return {
        action: args.action,
        installation: { id: 99 },
        repository: {
          id: args.repoId ?? LINKED_REPO_ID,
          name,
          full_name: fullName,
          owner: { login: owner },
        },
        issue: {
          number: args.number,
          title: args.title ?? `Synced ${args.number}`,
          body: 'From GitHub',
          state: args.state ?? 'open',
          state_reason: args.stateReason ?? null,
          html_url: `https://github.com/${fullName}/issues/${args.number}`,
          labels: (args.labels ?? []).map((label) => ({ name: label })),
          assignees: args.assignees ?? [],
          user: { id: 777, login: 'outsider' },
          updated_at: args.updatedAt,
        },
        sender: { login: args.sender ?? 'octocat', type: 'User' },
      }
    }

    async function linkedIssues(number: number, fullName = LINKED_REPO) {
      return testDb.db
        .select({
          issue: schema.issue,
          metadata: schema.issueSourceBinding.metadata,
        })
        .from(schema.issueSourceBinding)
        .innerJoin(
          schema.issue,
          eq(schema.issue.id, schema.issueSourceBinding.issueId),
        )
        .where(
          eq(schema.issueSourceBinding.externalId, `${fullName}#${number}`),
        )
    }

    async function openLinkedIssue(
      overrides: Partial<Parameters<typeof linkedPayload>[0]> = {},
    ) {
      linkedNumber += 1
      const number = linkedNumber
      const response = await deliver({
        payload: linkedPayload({
          action: 'opened',
          number,
          updatedAt: '2026-05-01T10:00:00Z',
          ...overrides,
        }),
      })
      expect(response.status).toBe(200)
      const [row] = await linkedIssues(number)
      return { number, issueId: row!.issue.id }
    }

    it('creates the Garden issue on the Team board when a linked repository opens one, once', async () => {
      linkedNumber += 1
      const number = linkedNumber
      const payload = linkedPayload({
        action: 'opened',
        number,
        updatedAt: '2026-05-01T10:00:00Z',
        assignees: [
          { id: 900, login: 'stranger' },
          { id: 501, login: 'member-gh' },
        ],
        labels: ['bug'],
      })
      const deliveryId = randomUUID()
      const first = await deliver({ payload, deliveryId })
      expect(first.status).toBe(200)

      const rows = await linkedIssues(number)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.issue).toMatchObject({
        teamId,
        status: 'todo',
        title: `Synced ${number}`,
        labels: ['bug'],
        assigneeType: 'user',
        assigneeId: memberId,
        createdBy: ownerId,
      })
      expect(harness.published).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'issue:created' }),
        ]),
      )

      await deliver({ payload, deliveryId })
      await deliver({ payload })
      expect(await linkedIssues(number)).toHaveLength(1)
    })

    it('creates an issue the Garden App bot opened and still skips its later echoes', async () => {
      const { number, issueId } = await openLinkedIssue({
        sender: 'garden-ai-dev[bot]',
        labels: ['bug'],
      })
      expect(await readIssue(issueId)).toMatchObject({
        teamId,
        labels: ['bug'],
      })

      const echo = await deliver({
        payload: linkedPayload({
          action: 'labeled',
          number,
          updatedAt: '2026-05-01T11:00:00Z',
          labels: ['bug', 'echo'],
          sender: 'garden-ai-dev[bot]',
        }),
      })
      expect(echo.body).toMatchObject({
        status: 'skipped',
        skipped_reason: 'own_app_sender',
      })
      expect((await readIssue(issueId))?.labels).toEqual(['bug'])
    })

    it('creates a closed issue whose close arrives before the import reaches it, and the import keeps it closed', async () => {
      const repoId = 4343
      const fullName = 'Flow-Research/importing-repo'
      const [link] = await testDb.db
        .insert(schema.teamRepository)
        .values({
          workspaceId,
          teamId,
          githubRepoId: repoId,
          fullName,
          linkedBy: ownerId,
          importState: 'importing',
        })
        .returning()
      const closed = linkedPayload({
        action: 'closed',
        number: 7,
        repoId,
        fullName,
        state: 'closed',
        stateReason: 'completed',
        updatedAt: '2026-05-02T10:00:00Z',
      })
      expect((await deliver({ payload: closed })).status).toBe(200)
      const [created] = await linkedIssues(7, fullName)
      expect(created?.issue.status).toBe('done')

      const importedPage = parseGitHubIssueSnapshot(
        {
          ...closed.issue,
          state: 'open',
          state_reason: null,
          updated_at: '2026-05-02T09:00:00Z',
        },
        fullName,
      )!
      const outcome = await upsertGitHubIssue({
        db: testDb.db,
        link: { ...link!, fullName },
        snapshot: importedPage,
      })
      expect(outcome.kind).toBe('existing')
      const rows = await linkedIssues(7, fullName)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.issue.status).toBe('done')
    })

    it('treats a webhook older than the snapshot an import wrote as stale', async () => {
      linkedNumber += 1
      const number = linkedNumber
      const imported = linkedPayload({
        action: 'opened',
        number,
        title: 'Imported title',
        updatedAt: '2026-05-03T10:00:00Z',
      })
      const outcome = await upsertGitHubIssue({
        db: testDb.db,
        link: {
          id: randomUUID(),
          workspaceId,
          teamId,
          linkedBy: ownerId,
          fullName: LINKED_REPO,
        },
        snapshot: parseGitHubIssueSnapshot(imported.issue, LINKED_REPO)!,
      })
      expect(outcome.kind).toBe('created')

      const late = await deliver({
        payload: linkedPayload({
          action: 'edited',
          number,
          title: 'Older title',
          updatedAt: '2026-05-03T09:00:00Z',
        }),
      })
      expect(late.body).toMatchObject({ status: 'stale' })
      const [row] = await linkedIssues(number)
      expect(row!.issue.title).toBe('Imported title')
    })

    it('ignores an opened issue on a repository no Team links', async () => {
      const response = await deliver({
        payload: linkedPayload({
          action: 'opened',
          number: 1,
          repoId: 5151,
          fullName: 'Flow-Research/unlinked',
          updatedAt: '2026-05-01T10:00:00Z',
        }),
      })
      expect(response.status).toBe(200)
      expect(response.json.status).toBe('unbound')
      expect(await linkedIssues(1, 'Flow-Research/unlinked')).toHaveLength(0)
    })

    it('follows GitHub for human assignees, keeps agent assignees, and records unmatched logins', async () => {
      const { number, issueId } = await openLinkedIssue({
        assignees: [{ id: 501, login: 'member-gh' }],
      })
      expect((await readIssue(issueId))?.assigneeId).toBe(memberId)

      await deliver({
        payload: linkedPayload({
          action: 'assigned',
          number,
          updatedAt: '2026-05-01T11:00:00Z',
          assignees: [{ id: 900, login: 'stranger' }],
        }),
      })
      const [unmatched] = await linkedIssues(number)
      expect(unmatched!.issue).toMatchObject({
        assigneeType: null,
        assigneeId: null,
      })
      expect(unmatched!.metadata).toEqual({ github_assignees: ['stranger'] })

      await testDb.db
        .update(schema.issue)
        .set({ assigneeType: 'agent', assigneeId: agentId })
        .where(eq(schema.issue.id, issueId))
      await deliver({
        payload: linkedPayload({
          action: 'unassigned',
          number,
          updatedAt: '2026-05-01T12:00:00Z',
          assignees: [],
        }),
      })
      expect(await readIssue(issueId)).toMatchObject({
        assigneeType: 'agent',
        assigneeId: agentId,
      })
    })

    it('maps GitHub close reasons and leaves Garden progress alone while open', async () => {
      const { number, issueId } = await openLinkedIssue()
      await testDb.db
        .update(schema.issue)
        .set({ status: 'in_progress' })
        .where(eq(schema.issue.id, issueId))

      await deliver({
        payload: linkedPayload({
          action: 'labeled',
          number,
          updatedAt: '2026-05-01T11:00:00Z',
          labels: ['bug', 'p1'],
        }),
      })
      expect(await readIssue(issueId)).toMatchObject({
        status: 'in_progress',
        labels: ['bug', 'p1'],
      })

      await deliver({
        payload: linkedPayload({
          action: 'closed',
          number,
          state: 'closed',
          stateReason: 'not_planned',
          updatedAt: '2026-05-01T12:00:00Z',
        }),
      })
      expect((await readIssue(issueId))?.status).toBe('cancelled')

      await deliver({
        payload: linkedPayload({
          action: 'reopened',
          number,
          updatedAt: '2026-05-01T13:00:00Z',
        }),
      })
      expect((await readIssue(issueId))?.status).toBe('todo')

      await deliver({
        payload: linkedPayload({
          action: 'closed',
          number,
          state: 'closed',
          stateReason: 'completed',
          updatedAt: '2026-05-01T14:00:00Z',
        }),
      })
      expect((await readIssue(issueId))?.status).toBe('done')
    })
  })
})
