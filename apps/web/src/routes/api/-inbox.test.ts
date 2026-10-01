// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { AppRequestContext } from '@/lib/server/context'
import { getInbox } from '@/routes/api/inbox'

const mockRequireAppRequestContext = vi.hoisted(() => vi.fn())
const mockRequireWorkspaceContext = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: mockRequireAppRequestContext,
}))

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return { ...actual, requireWorkspaceContext: mockRequireWorkspaceContext }
})

const mockGetDb = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return { ...actual, getDb: mockGetDb }
})

const TEST_DB_HOOK_TIMEOUT_MS = 120_000
const ctx = {} as AppRequestContext

describe('GET /api/inbox brain proposals', () => {
  let testDb: TestDb
  let workspaceId: string
  let ownerId: string
  let otherId: string
  let fallbackId: string
  let proposalId: string

  beforeAll(async () => {
    testDb = await startTestDb()
    mockGetDb.mockImplementation(async () => testDb.db)
    workspaceId = randomUUID()
    ownerId = randomUUID()
    otherId = randomUUID()
    fallbackId = randomUUID()
    proposalId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Inbox route workspace',
      slug: `inbox-route-${workspaceId}`,
    })
    await testDb.db.insert(schema.user).values([
      { id: ownerId, email: `${ownerId}@example.com`, name: 'Owner' },
      { id: otherId, email: `${otherId}@example.com`, name: 'Other' },
      { id: fallbackId, email: `${fallbackId}@example.com`, name: 'Fallback' },
    ])
    await testDb.db.insert(schema.brainWriteProposal).values({
      id: proposalId,
      workspaceId,
      runId: 'run-1',
      claimHash: 'hash-1',
      claim: 'Alice prefers short replies.',
      kind: 'preference',
      confidence: 0.9,
      scope: { kind: 'user', userId: ownerId },
      status: 'pending',
    })
    await testDb.db.insert(schema.inboxItem).values({
      id: randomUUID(),
      workspaceId,
      recipientType: 'member',
      recipientId: fallbackId,
      itemKey: 'seeded:1',
      type: 'issue_assigned',
      severity: 'action_required',
      title: 'Seeded card',
      activityAt: new Date(),
    })
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  function setupRequest(userId: string) {
    mockRequireAppRequestContext.mockReturnValueOnce({
      db: async () => testDb.db,
    })
    mockRequireWorkspaceContext.mockResolvedValueOnce({
      session: { user: { id: userId } },
      workspaceId,
    })
  }

  it('returns the pending proposal card for the scoped owner', async () => {
    setupRequest(ownerId)

    const response = await getInbox({ context: ctx })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ id: string }>
    expect(
      body.filter((item) => item.id === `brain_proposal:${proposalId}`),
    ).toHaveLength(1)
  })

  it('returns an empty list when the workspace is missing', async () => {
    mockRequireAppRequestContext.mockReturnValueOnce({
      db: async () => testDb.db,
    })
    mockRequireWorkspaceContext.mockResolvedValueOnce(
      Response.json([], { status: 200 }),
    )

    const response = await getInbox({ context: ctx })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })

  it('still returns persisted items when reconciliation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetDb.mockRejectedValueOnce(new Error('reconcile down'))
    setupRequest(fallbackId)

    const response = await getInbox({ context: ctx })
    vi.restoreAllMocks()

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ id: string }>
    expect(body.filter((item) => item.id === 'seeded:1')).toHaveLength(1)
  })
})
