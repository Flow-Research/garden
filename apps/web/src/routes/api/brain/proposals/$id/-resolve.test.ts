// @vitest-environment node
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
  claimHash: 'hash-1',
  claim: 'Alice prefers short replies.',
  kind: 'preference',
  confidence: 0.9,
  scope: { kind: 'user', userId: ownerId },
  status: 'pending',
})

function fakeDb(
  row: ReturnType<typeof proposalRow>,
  options: {
    claimedRows?: Array<{ id: string }>
    currentStatus?: string
  } = {},
) {
  const updates: Array<Record<string, unknown>> = []
  const claimedRows = options.claimedRows ?? [{ id: row.id }]
  let selectCalls = 0
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            selectCalls += 1
            if (selectCalls === 1) return [row]
            return [
              {
                status:
                  options.currentStatus === undefined
                    ? row.status
                    : options.currentStatus,
              },
            ]
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload)
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => claimedRows),
          })),
        }
      }),
    })),
  }
  return { db, updates }
}

function approveRequest() {
  return new Request(
    `https://garden.test/api/brain/proposals/${proposalId}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    },
  )
}

async function postResolve(args: { db: unknown; userId: string }) {
  mockRequireAppRequestContext.mockReturnValueOnce({ db: async () => args.db })
  mockRequireWorkspaceContext.mockResolvedValueOnce({
    session: { user: { id: args.userId } },
    workspaceId,
  })
  return resolveBrainProposal({
    context: {} as AppRequestContext,
    request: approveRequest(),
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

  it('writes the stored user scope when the scoped owner approves', async () => {
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

  it('does not write to the brain when a concurrent approve already claimed the row', async () => {
    const { db, updates } = fakeDb(proposalRow(), {
      claimedRows: [],
      currentStatus: 'approved',
    })

    const response = await postResolve({ db, userId: ownerId })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'approved',
    })
    expect(mockAddText).not.toHaveBeenCalled()
    expect(mockArchiveInboxItemsByKey).toHaveBeenCalledOnce()
    expect(updates).toMatchObject([{ status: 'approved' }])
  })
})
