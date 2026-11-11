// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewWorkProduct, workProductReviewBodySchema } from './work-products'

const state = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, getDb: async () => state.db }
})

vi.mock('@garden/server/issues/server', () => ({
  wakeAgentsForIssueComment: vi.fn(),
}))

const workspaceId = '00000000-0000-4000-8000-000000000001'
const issueId = '00000000-0000-4000-8000-000000000002'
const workProductId = '00000000-0000-4000-8000-000000000003'
const runId = '00000000-0000-4000-8000-000000000004'

const workProductRow = () => ({
  id: workProductId,
  workspaceId,
  issueId,
  runId,
  agentId: null,
  type: 'brief',
  status: 'review',
  reviewState: 'pending',
  isPrimary: false,
  title: 'Brief',
  body: 'An agent wrote this.',
  payload: {},
  appliedAt: null,
  appliedExternalId: null,
  appliedExternalUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

type InsertRow = {
  eventType?: string
  message?: string
  payload?: unknown
}

function makeDb(args: { issueUpdateReturns: Array<{ id: string }> }) {
  const inserts: InsertRow[] = []
  const sets: Array<Record<string, unknown>> = []
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          sets.push(values)
          return { returning: async () => args.issueUpdateReturns }
        },
      }),
    }),
    execute: async () => undefined,
    select: () => ({
      from: () => ({
        where: async () => [{ nextSeq: 1 }],
      }),
    }),
    insert: () => ({
      values: async (rows: InsertRow | InsertRow[]) => {
        if (Array.isArray(rows)) inserts.push(...rows)
        else inserts.push(rows)
      },
    }),
  }
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [
              {
                workProduct: workProductRow(),
                issue: { id: issueId, status: 'in_review' },
              },
            ],
          }),
        }),
      }),
    }),
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  }
  return { db, inserts, sets }
}

describe('reviewWorkProduct approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('leaves the issue alone when the in_review status changed after load', async () => {
    const { db, inserts } = makeDb({ issueUpdateReturns: [] })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve', close_issue: true },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(
      inserts.some(
        (row) => row.eventType === 'issue_run:work_product_approved',
      ),
    ).toBe(true)
    expect(inserts.some((row) => row.eventType === 'issue_run:message')).toBe(
      false,
    )
  })

  it('moves the issue to done only when the conditional update claims it', async () => {
    const { db, inserts, sets } = makeDb({
      issueUpdateReturns: [{ id: issueId }],
    })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve', close_issue: true },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(inserts.some((row) => row.eventType === 'issue_run:message')).toBe(
      true,
    )
    expect(sets.some((values) => values.status === 'done')).toBe(true)
  })

  it('approve without close keeps the issue open by moving in_review to in_progress', async () => {
    const { db, inserts, sets } = makeDb({
      issueUpdateReturns: [{ id: issueId }],
    })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve', close_issue: false },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(sets.some((values) => values.status === 'done')).toBe(false)
    expect(sets.some((values) => values.status === 'in_progress')).toBe(true)
    expect(
      inserts.find((row) => row.eventType === 'issue_run:message')?.payload,
    ).toEqual({ from: 'in_review', to: 'in_progress' })
  })
})

describe('workProductReviewBodySchema', () => {
  it('rejects an approve request that omits close_issue', () => {
    expect(
      workProductReviewBodySchema.safeParse({ action: 'approve' }).success,
    ).toBe(false)
  })
})
