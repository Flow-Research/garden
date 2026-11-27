// @vitest-environment node
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DateTime, Effect, Layer } from 'effect'
import { ItemId, Kind } from '@garden/brain/domain'
import type { AppRequestContext } from '@/lib/server/context'
import { bindAppEnv, type AppEnv } from '@/lib/server/env'
import { resolveBrainProposal } from './resolve'

const mockRequireAppRequestContext = vi.hoisted(() => vi.fn())
const mockRequireWorkspaceContext = vi.hoisted(() => vi.fn())
const mockArchiveInboxItemsByKey = vi.hoisted(() => vi.fn())
const mockAddText = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: mockRequireAppRequestContext,
}))

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return { ...actual, requireWorkspaceContext: mockRequireWorkspaceContext }
})

vi.mock('@garden/db/inbox', () => ({
  archiveInboxItemsByKey: mockArchiveInboxItemsByKey,
}))

vi.mock('@garden/brain/services/web', async () => {
  const { Brain: BrainService } = await vi.importActual<
    typeof import('@garden/brain/services/brain')
  >('@garden/brain/services/brain')
  const unused = () => Effect.die('unused Brain operation')
  return {
    makeWebBrainLive: () =>
      Layer.succeed(
        BrainService,
        BrainService.of({
          ensureIndexes: () => Effect.void,
          addItem: () => Effect.die('unused addItem'),
          addText: (input) => mockAddText(input),
          updateIndexStatus: () => Effect.die('unused updateIndexStatus'),
          deleteFile: () => Effect.die('unused deleteFile'),
          updateItemMetadata: () => Effect.die('unused updateItemMetadata'),
          index: () => Effect.die('unused index'),
          read: () => Effect.die('unused read'),
          readFileItem: () => Effect.die('unused readFileItem'),
          search: () => Effect.die('unused search'),
          listFiles: () => Effect.die('unused listFiles'),
          linkSections: unused,
          sectionsOf: unused,
          observeMention: () => Effect.die('unused observeMention'),
          linkItems: () => Effect.die('unused linkItems'),
          neighborhood: () => Effect.die('unused neighborhood'),
          readFile: () => Effect.die('unused readFile'),
        }),
      ),
  }
})

const workspaceId = '00000000-0000-4000-8000-000000000001'
const proposalId = '00000000-0000-4000-8000-000000000002'
const ownerId = '00000000-0000-4000-8000-000000000003'
const otherId = '00000000-0000-4000-8000-000000000004'

const proposalRow = () => ({
  id: proposalId,
  workspaceId,
  runId: 'run-1',
  claimHash: 'legacy-run-hash',
  claim: 'Alice prefers short replies.',
  kind: 'preference',
  confidence: 0.9,
  scope: { kind: 'user', userId: ownerId },
  status: 'pending',
})

/** Models the proposal row lock and the pending-only claim index in this route test. */
function fakeDb(row: ReturnType<typeof proposalRow>) {
  const updates: Array<Record<string, unknown>> = []
  const lock = vi.fn(async (mode: string) => {
    if (mode !== 'update')
      throw new Error('Approval requires an exclusive row lock')
    return [row]
  })
  let previous = Promise.resolve()
  const db = {
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const waiting = previous
      let releaseLock = () => {}
      previous = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      await waiting
      try {
        return await work(db)
      } finally {
        releaseLock()
      }
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: lock,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload)
        return {
          where: vi.fn(async () => {
            if (typeof payload.status === 'string') row.status = payload.status
          }),
        }
      }),
    })),
  }
  return {
    db,
    updates,
    row,
    lock,
    canInsertCompeting: () => row.status !== 'pending',
  }
}

function resolveRequest(action: 'approve' | 'reject' = 'approve') {
  return new Request(
    `https://garden.test/api/brain/proposals/${proposalId}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    },
  )
}

async function postResolve(args: {
  db: unknown
  userId: string
  action?: 'approve' | 'reject'
}) {
  mockRequireAppRequestContext.mockReturnValue({ db: async () => args.db })
  mockRequireWorkspaceContext.mockResolvedValue({
    session: { user: { id: args.userId } },
    workspaceId,
  })
  return resolveBrainProposal({
    context: {} as AppRequestContext,
    request: resolveRequest(args.action),
    params: { id: proposalId },
  })
}

describe('resolveBrainProposal user scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bindAppEnv({ HELIX_URL: 'http://localhost:6968' } as AppEnv)
    mockAddText.mockImplementation((input) =>
      Effect.succeed({
        id: ItemId.make('item-1'),
        tenantId: input.tenantId,
        kind: input.kind ?? Kind.make('note'),
        label: input.label,
        indexed: true,
        origin: {
          actor: input.actor,
          at: DateTime.makeUnsafe(new Date('2026-01-01T00:00:00Z')),
        },
        body: input.body,
      }),
    )
    mockArchiveInboxItemsByKey.mockResolvedValue(undefined)
  })

  it('uses the direct-write identity when the owner approves a legacy run-scoped claim', async () => {
    const { db, updates } = fakeDb(proposalRow())

    const response = await postResolve({ db, userId: ownerId })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'approved',
    })
    expect(mockAddText).toHaveBeenCalledOnce()
    expect(mockAddText.mock.calls[0]?.[0]).toMatchObject({
      scope: { kind: 'user', userId: ownerId },
      canonical: {
        type: 'brain-write-back-claim',
        value: `${workspaceId}:${createHash('sha256')
          .update(`user:${ownerId}:alice prefers short replies.`)
          .digest('hex')}`,
      },
    })
    expect(updates).toMatchObject([{ status: 'approved', decidedBy: ownerId }])
  })

  it('returns 404 and writes nothing when another user approves', async () => {
    const { db, updates } = fakeDb(proposalRow())

    const response = await postResolve({ db, userId: otherId })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Proposal not found',
    })
    expect(mockAddText).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(mockArchiveInboxItemsByKey).not.toHaveBeenCalled()
  })

  it('does not write to the brain when approval was already committed', async () => {
    const row = proposalRow()
    row.status = 'approved'
    const { db, updates } = fakeDb(row)

    const response = await postResolve({ db, userId: ownerId })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'approved',
    })
    expect(mockAddText).not.toHaveBeenCalled()
    expect(mockArchiveInboxItemsByKey).toHaveBeenCalledOnce()
    expect(updates).toHaveLength(0)
  })

  it('keeps a committed rejection when approval arrives later', async () => {
    const { db, updates, row } = fakeDb(proposalRow())

    const rejection = await postResolve({
      db,
      userId: ownerId,
      action: 'reject',
    })
    expect(rejection.status).toBe(200)

    const approval = await postResolve({ db, userId: ownerId })
    await expect(approval.json()).resolves.toMatchObject({ status: 'rejected' })
    expect(row.status).toBe('rejected')
    expect(updates).toHaveLength(1)
    expect(mockAddText).not.toHaveBeenCalled()
  })

  it('keeps the claim pending on write failure and permits an honest retry', async () => {
    const { db, updates, row, canInsertCompeting } = fakeDb(proposalRow())
    let releaseWrite = () => {}
    let signalStarted = () => {}
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    mockAddText.mockReturnValueOnce(
      Effect.flatMap(
        Effect.promise(async () => {
          signalStarted()
          await writeGate
        }),
        () => Effect.fail(new Error('private Helix detail')),
      ),
    )

    const failure = postResolve({ db, userId: ownerId })
    await started
    expect(canInsertCompeting()).toBe(false)
    releaseWrite()
    const failed = await failure

    expect(failed.status).toBe(502)
    await expect(failed.json()).resolves.toEqual({
      error: 'Could not write to the brain',
    })
    expect(row.status).toBe('pending')
    expect(canInsertCompeting()).toBe(false)
    expect(updates).toHaveLength(0)
    expect(mockArchiveInboxItemsByKey).not.toHaveBeenCalled()

    const retried = await postResolve({ db, userId: ownerId })
    expect(retried.status).toBe(200)
    expect(row.status).toBe('approved')
    expect(updates).toHaveLength(1)
    expect(mockAddText).toHaveBeenCalledTimes(2)
  })

  it('serializes rejection behind approval while the pending claim is held', async () => {
    const { db, updates, row, lock } = fakeDb(proposalRow())
    let releaseWrite = () => {}
    let signalStarted = () => {}
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    mockAddText.mockImplementationOnce((input) =>
      Effect.flatMap(
        Effect.promise(async () => {
          signalStarted()
          await writeGate
        }),
        () =>
          Effect.succeed({
            id: ItemId.make('item-1'),
            tenantId: input.tenantId,
            kind: input.kind ?? Kind.make('note'),
            label: input.label,
            indexed: true,
            origin: {
              actor: input.actor,
              at: DateTime.makeUnsafe(new Date('2026-01-01T00:00:00Z')),
            },
            body: input.body,
          }),
      ),
    )

    const approval = postResolve({ db, userId: ownerId })
    await started
    expect(lock).toHaveBeenCalledWith('update')
    const rejection = postResolve({ db, userId: ownerId, action: 'reject' })
    expect(row.status).toBe('pending')
    expect(updates).toHaveLength(0)

    releaseWrite()
    expect((await approval).status).toBe(200)
    const rejected = await rejection
    await expect(rejected.json()).resolves.toMatchObject({ status: 'approved' })
    expect(row.status).toBe('approved')
    expect(updates).toHaveLength(1)
    expect(mockAddText).toHaveBeenCalledOnce()
  })
})
