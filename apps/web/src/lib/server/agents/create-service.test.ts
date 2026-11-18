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

    const result = await createWorkspaceAgent({
      db: {} as never,
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
    expect(mocks.insertAgent).toHaveBeenCalledOnce()
    expect(mocks.bindExistingCapabilitiesToAgent).toHaveBeenCalledWith({
      db: {},
      agentId: 'agent-1',
      grantedBy: 'user-1',
    })
  })

  it('maps insert failures to AgentCreateError 500', async () => {
    mocks.insertAgent.mockRejectedValue(new Error('db down'))

    const result = await createWorkspaceAgent({
      db: {} as never,
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Broken',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error._tag).toBe('AgentCreateError')
    expect(result.error.status).toBe(500)
    expect(result.error.message).toBe('Failed to create agent')
    expect(result.error.cause).toBeInstanceOf(Error)
    expect(mocks.bindExistingCapabilitiesToAgent).not.toHaveBeenCalled()
  })
})
