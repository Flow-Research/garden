// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  removeConnectionGrant,
  setConnectionGrant,
} from './connection-grant-service'

const mocks = vi.hoisted(() => ({
  agentExistsInWorkspace: vi.fn(),
  upsertConnectionGrant: vi.fn(),
  deleteConnectionGrant: vi.fn(),
}))

vi.mock('@/lib/server/queries/issues/agents', () => ({
  agentExistsInWorkspace: mocks.agentExistsInWorkspace,
}))

vi.mock('@/lib/server/queries/connections', () => ({
  upsertConnectionGrant: mocks.upsertConnectionGrant,
  deleteConnectionGrant: mocks.deleteConnectionGrant,
}))

describe('setConnectionGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects connection-scoped auto trust with 400', async () => {
    const result = await setConnectionGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      trustLevel: 'auto',
      grantedBy: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(400)
    expect(result.error.message).toBe(
      'Auto trust is only available for individual read tools',
    )
    expect(mocks.agentExistsInWorkspace).not.toHaveBeenCalled()
    expect(mocks.upsertConnectionGrant).not.toHaveBeenCalled()
  })

  it('returns 404 when the agent is missing', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(false)

    const result = await setConnectionGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'missing',
      connectorId: 'github',
      trustLevel: 'allow',
      grantedBy: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
    expect(result.error.message).toBe('Agent not found')
    expect(mocks.upsertConnectionGrant).not.toHaveBeenCalled()
  })

  it('upserts an allow grant when the agent exists', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(true)
    mocks.upsertConnectionGrant.mockResolvedValue(undefined)

    const result = await setConnectionGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      trustLevel: 'allow',
      grantedBy: 'user-1',
    })

    expect(result.isOk()).toBe(true)
    expect(mocks.upsertConnectionGrant).toHaveBeenCalledWith(
      {},
      {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        connectorId: 'github',
        trustLevel: 'allow',
        grantedBy: 'user-1',
      },
    )
  })
})

describe('removeConnectionGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when the agent is missing', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(false)

    const result = await removeConnectionGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'missing',
      connectorId: 'github',
      actorId: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
    expect(mocks.deleteConnectionGrant).not.toHaveBeenCalled()
  })

  it('deletes the grant when the agent exists', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(true)
    mocks.deleteConnectionGrant.mockResolvedValue(undefined)

    const result = await removeConnectionGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      actorId: 'user-1',
    })

    expect(result.isOk()).toBe(true)
    expect(mocks.deleteConnectionGrant).toHaveBeenCalledWith(
      {},
      {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        connectorId: 'github',
        actorId: 'user-1',
      },
    )
  })
})
