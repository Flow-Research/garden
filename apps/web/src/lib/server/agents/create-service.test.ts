// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { createWorkspaceAgent } from './create-service'

const mocks = vi.hoisted(() => ({
  insertAgent: vi.fn(),
  bindExistingCapabilitiesToAgent: vi.fn(),
}))

vi.mock('@/lib/server/queries/agents', () => ({
  insertAgent: mocks.insertAgent,
  bindExistingCapabilitiesToAgent: mocks.bindExistingCapabilitiesToAgent,
}))

// Stands in for Drizzle's db: runs the callback with a distinct tx handle and
// propagates its rejection, as `db.transaction` does after rolling back.
function fakeDb() {
  const tx = { kind: 'tx' }
  const transaction = vi.fn(async (fn: (handle: typeof tx) => unknown) =>
    fn(tx),
  )
  return { db: { transaction } as never, tx, transaction }
}

describe('createWorkspaceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts agent, seeds capability grants, returns DTO', async () => {
    const now = new Date('2026-11-18T00:00:00.000Z')
    mocks.insertAgent.mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Researcher',
      roleTitle: 'Finds sources',
      instructions: 'Be careful',
      persona: '{"mode":"fast"}',
      status: 'active',
      hostName: 'agent-1',
      permissions: DEFAULT_AGENT_PERMISSIONS,
      isDefault: false,
      reportsTo: null,
      createdAt: now,
      updatedAt: now,
    })
    mocks.bindExistingCapabilitiesToAgent.mockResolvedValue(undefined)
    const { db, tx, transaction } = fakeDb()

    const result = await createWorkspaceAgent({
      db,
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Researcher',
      description: 'Finds sources',
      instructions: 'Be careful',
      runtimeConfig: { mode: 'fast' },
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toMatchObject({
      id: 'agent-1',
      workspace_id: 'ws-1',
      name: 'Researcher',
      description: 'Finds sources',
      instructions: 'Be careful',
      record_status: 'active',
    })
    expect(transaction).toHaveBeenCalledOnce()
    expect(mocks.insertAgent).toHaveBeenCalledOnce()
    expect(mocks.insertAgent.mock.calls[0]?.[0]).toBe(tx)
    expect(mocks.bindExistingCapabilitiesToAgent).toHaveBeenCalledWith({
      db: tx,
      agentId: 'agent-1',
      grantedBy: 'user-1',
    })
  })

  it('maps insert failures to fixed AgentCreateError without leaking cause text', async () => {
    const cause = Object.assign(
      new Error('Failed query: params: secret-instructions'),
      {
        cause: { code: '23505', constraint: 'agent_pkey' },
      },
    )
    mocks.insertAgent.mockRejectedValue(cause)

    const result = await createWorkspaceAgent({
      db: fakeDb().db,
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Broken',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error._tag).toBe('AgentCreateError')
    expect(result.error.status).toBe(500)
    expect(result.error.message).toBe('Failed to create agent')
    expect(result.error.message).not.toContain('secret-instructions')
    expect(result.error.cause).toBe(cause)
    expect(mocks.bindExistingCapabilitiesToAgent).not.toHaveBeenCalled()
  })

  it('runs grant seeding in the agent insert transaction and fails when it fails', async () => {
    mocks.insertAgent.mockResolvedValue({ id: 'agent-1' })
    const cause = new Error('grant insert failed')
    mocks.bindExistingCapabilitiesToAgent.mockRejectedValue(cause)
    const { db, tx, transaction } = fakeDb()

    const result = await createWorkspaceAgent({
      db,
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Half made',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.message).toBe('Failed to create agent')
    expect(result.error.cause).toBe(cause)
    expect(transaction).toHaveBeenCalledOnce()
    await expect(transaction.mock.results[0]?.value).rejects.toBe(cause)
    expect(mocks.insertAgent.mock.calls[0]?.[0]).toBe(tx)
    expect(mocks.bindExistingCapabilitiesToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ db: tx, agentId: 'agent-1' }),
    )
  })
})
