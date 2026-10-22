// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewWorkProduct } from './work-products'

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

type InsertRow = { eventType?: string }

function makeDb(args: { issueUpdateReturns: Array<{ id: string }> }) {
  const inserts: InsertRow[] = []
  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => args.issueUpdateReturns,
        }),
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
  return { db, inserts }
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
      input: { action: 'approve' },
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
    const { db, inserts } = makeDb({ issueUpdateReturns: [{ id: issueId }] })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve' },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(inserts.some((row) => row.eventType === 'issue_run:message')).toBe(
      true,
    )
  })
})
