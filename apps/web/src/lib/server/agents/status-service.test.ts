// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import {
  resolveAgentWorkspaceForStatus,
  updateAgentStatus,
} from './status-service'

const mocks = vi.hoisted(() => ({
  getAgentWorkspaceHost: vi.fn(),
  setAgentRowStatus: vi.fn(),
}))

vi.mock('@/lib/server/queries/agents', () => ({
  getAgentWorkspaceHost: mocks.getAgentWorkspaceHost,
  setAgentRowStatus: mocks.setAgentRowStatus,
}))

const agentRow = {
  id: 'agent-1',
  workspaceId: 'ws-1',
  ownerUserId: 'user-1',
  name: 'Garden',
  roleTitle: null,
  instructions: null,
  persona: null,
  status: 'archived' as const,
  hostName: 'agent-1',
  permissions: DEFAULT_AGENT_PERMISSIONS,
  isDefault: true,
  reportsTo: null,
  createdAt: new Date('2026-11-18T00:00:00.000Z'),
  updatedAt: new Date('2026-11-18T00:00:00.000Z'),
}

describe('updateAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('archives an agent and returns DTO', async () => {
    mocks.setAgentRowStatus.mockResolvedValue(agentRow)

    const result = await updateAgentStatus({
      db: {} as never,
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      status: 'archived',
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.record_status).toBe('archived')
    expect(result.value.status).toBe('offline')
    expect(mocks.setAgentRowStatus).toHaveBeenCalledWith(
      {},
      {
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        status: 'archived',
      },
    )
  })

  it('returns 404 when the row is missing', async () => {
    mocks.setAgentRowStatus.mockResolvedValue(null)

    const result = await updateAgentStatus({
      db: {} as never,
      agentId: 'missing',
      workspaceId: 'ws-1',
      status: 'active',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
    expect(result.error.message).toBe('Agent not found')
  })
})

describe('resolveAgentWorkspaceForStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns workspace id for permission gating', async () => {
    mocks.getAgentWorkspaceHost.mockResolvedValue({
      workspaceId: 'ws-1',
      hostName: 'host-1',
    })

    const result = await resolveAgentWorkspaceForStatus({} as never, 'agent-1')

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.workspaceId).toBe('ws-1')
  })

  it('returns 404 when agent is missing', async () => {
    mocks.getAgentWorkspaceHost.mockResolvedValue(null)

    const result = await resolveAgentWorkspaceForStatus({} as never, 'missing')

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
  })
})
