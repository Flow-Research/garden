// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { reconcileInboxItems } from './inbox-compute'

const mockGetDb = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return { ...actual, getDb: mockGetDb }
})

const TEST_DB_HOOK_TIMEOUT_MS = 120_000

describe('inbox recipient scoping (integration)', () => {
  let testDb: TestDb
  let workspaceId: string
  let ownerUserId: string
  let otherUserId: string
  let agentId: string
  let issueId: string
  let runId: string
  let proposalId: string
  let workProductId: string

  beforeAll(async () => {
    testDb = await startTestDb()
    mockGetDb.mockResolvedValue(testDb.db)
    workspaceId = randomUUID()
    ownerUserId = randomUUID()
    otherUserId = randomUUID()
    agentId = randomUUID()
    issueId = randomUUID()
    runId = randomUUID()
    proposalId = randomUUID()
    workProductId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Inbox workspace',
      slug: `inbox-${workspaceId}`,
    })
    await testDb.db.insert(schema.user).values([
      { id: ownerUserId, email: `${ownerUserId}@example.com`, name: 'Owner' },
      { id: otherUserId, email: `${otherUserId}@example.com`, name: 'Other' },
    ])
    await testDb.db.insert(schema.member).values([
      {
        id: randomUUID(),
        organizationId: workspaceId,
        userId: ownerUserId,
        role: 'owner',
      },
      {
        id: randomUUID(),
        organizationId: workspaceId,
        userId: otherUserId,
        role: 'member',
      },
    ])
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId,
      name: 'Garden',
    })
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      number: 1,
      title: 'Refund tone guide',
      status: 'in_review',
      createdBy: ownerUserId,
      assigneeType: 'agent',
      assigneeId: agentId,
    })
    await testDb.db.insert(schema.issueRun).values({
      id: runId,
      workspaceId,
      issueId,
      agentId,
      hostName: 'test-host',
      status: 'succeeded',
    })
    await testDb.db.insert(schema.issueWorkProduct).values({
      id: workProductId,
      workspaceId,
      issueId,
      runId,
      agentId,
      type: 'brief',
      status: 'review',
      reviewState: 'pending',
      title: 'Refund tone guide',
      body: 'Three rules for refund replies.',
    })
    await testDb.db.insert(schema.brainWriteProposal).values({
      id: proposalId,
      workspaceId,
      runId: `brain-write-back:issue:${runId}`,
      claimHash: 'hash-1',
      claim: 'Refund replies lead with the decision.',
      kind: 'rule',
      confidence: 0.6,
      scope: { kind: 'org' },
      status: 'pending',
    })
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  it('shows the proposal to the run owner', async () => {
    const items = await reconcileInboxItems({
      workspaceId,
      userId: ownerUserId,
    })
    expect(
      items.filter((item) => item.id === `brain_proposal:${proposalId}`),
    ).toHaveLength(1)
  })

  it('hides the proposal from another member', async () => {
    const items = await reconcileInboxItems({
      workspaceId,
      userId: otherUserId,
    })
    expect(
      items.filter((item) => item.id === `brain_proposal:${proposalId}`),
    ).toHaveLength(0)
  })

  it('shows the work product review to the issue owner', async () => {
    const items = await reconcileInboxItems({
      workspaceId,
      userId: ownerUserId,
    })
    expect(
      items.filter((item) => item.id === `wp_review:${workProductId}`),
    ).toHaveLength(1)
  })

  it('hides the work product review from another member', async () => {
    const items = await reconcileInboxItems({
      workspaceId,
      userId: otherUserId,
    })
    expect(
      items.filter((item) => item.id === `wp_review:${workProductId}`),
    ).toHaveLength(0)
  })

  it('attributes the proposal to the producing agent', async () => {
    const items = await reconcileInboxItems({
      workspaceId,
      userId: ownerUserId,
    })
    const proposal = items.find(
      (item) => item.id === `brain_proposal:${proposalId}`,
    )
    expect(proposal?.actor_id).toBe(agentId)
    expect(proposal?.actor_type).toBe('agent')
  })

  it('does not duplicate cards on repeat reconcile', async () => {
    await reconcileInboxItems({ workspaceId, userId: ownerUserId })
    const items = await reconcileInboxItems({
      workspaceId,
      userId: ownerUserId,
    })
    expect(
      items.filter((item) => item.id === `brain_proposal:${proposalId}`),
    ).toHaveLength(1)
    expect(
      items.filter((item) => item.id === `wp_review:${workProductId}`),
    ).toHaveLength(1)
  })

  it('leaves event-driven cards reconcile does not own alone', async () => {
    await testDb.db.insert(schema.inboxItem).values({
      id: randomUUID(),
      workspaceId,
      recipientType: 'member',
      recipientId: ownerUserId,
      itemKey: `connector_needed:${issueId}:slack`,
      type: 'connector_needed',
      severity: 'action_required',
      title: 'Connect Slack to continue',
      body: 'Slack is not connected.',
      activityAt: new Date(),
    })
    await reconcileInboxItems({ workspaceId, userId: ownerUserId })
    const rows = await testDb.db
      .select()
      .from(schema.inboxItem)
      .where(eq(schema.inboxItem.recipientId, ownerUserId))
    expect(
      rows.filter(
        (row) => row.itemKey.startsWith('connector_needed:') && !row.archived,
      ),
    ).toHaveLength(1)
  })
})
