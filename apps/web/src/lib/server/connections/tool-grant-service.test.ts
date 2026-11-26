// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { removeToolGrant, setToolGrant } from './tool-grant-service'

const mocks = vi.hoisted(() => ({
  agentExistsInWorkspace: vi.fn(),
  getCapabilityByConnectorTool: vi.fn(),
  upsertToolPermissionGrant: vi.fn(),
  deleteToolPermissionGrant: vi.fn(),
}))

vi.mock('@/lib/server/queries/issues/agents', () => ({
  agentExistsInWorkspace: mocks.agentExistsInWorkspace,
}))

vi.mock('@/lib/server/queries/connections', () => ({
  getCapabilityByConnectorTool: mocks.getCapabilityByConnectorTool,
  upsertToolPermissionGrant: mocks.upsertToolPermissionGrant,
  deleteToolPermissionGrant: mocks.deleteToolPermissionGrant,
}))

describe('setToolGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentExistsInWorkspace.mockResolvedValue(true)
  })

  it('returns 404 when the agent is missing', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(false)

    const result = await setToolGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'missing',
      connectorId: 'github',
      toolName: 'list_issues',
      trustLevel: 'allow',
      grantedBy: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
    expect(result.error.message).toBe('Agent not found')
    expect(mocks.getCapabilityByConnectorTool).not.toHaveBeenCalled()
  })

  it('returns 404 when the tool capability is missing', async () => {
    mocks.getCapabilityByConnectorTool.mockResolvedValue(null)

    const result = await setToolGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      toolName: 'missing_tool',
      trustLevel: 'allow',
      grantedBy: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
    expect(result.error.message).toBe('Tool not found')
    expect(mocks.upsertToolPermissionGrant).not.toHaveBeenCalled()
  })

  it('allows auto trust for read tools', async () => {
    mocks.getCapabilityByConnectorTool.mockResolvedValue({
      id: 'cap-1',
      riskClass: 'read',
    })
    mocks.upsertToolPermissionGrant.mockResolvedValue(undefined)

    const result = await setToolGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      toolName: 'list_issues',
      trustLevel: 'auto',
      grantedBy: 'user-1',
    })

    expect(result.isOk()).toBe(true)
    expect(mocks.upsertToolPermissionGrant).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        capabilityId: 'cap-1',
        trustLevel: 'auto',
      }),
    )
  })

  it('rejects auto trust for non-read tools with 400', async () => {
    mocks.getCapabilityByConnectorTool.mockResolvedValue({
      id: 'cap-2',
      riskClass: 'write',
    })

    const result = await setToolGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      toolName: 'create_issue',
      trustLevel: 'auto',
      grantedBy: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(400)
    expect(result.error.message).toBe(
      'Auto trust is only available for read tools',
    )
    expect(mocks.upsertToolPermissionGrant).not.toHaveBeenCalled()
  })
})

describe('removeToolGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when the agent is missing', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(false)

    const result = await removeToolGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'missing',
      connectorId: 'github',
      toolName: 'list_issues',
      actorId: 'user-1',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.status).toBe(404)
    expect(mocks.deleteToolPermissionGrant).not.toHaveBeenCalled()
  })

  it('deletes the tool grant when the agent exists', async () => {
    mocks.agentExistsInWorkspace.mockResolvedValue(true)
    mocks.deleteToolPermissionGrant.mockResolvedValue(undefined)

    const result = await removeToolGrant({
      db: {} as never,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      connectorId: 'github',
      toolName: 'list_issues',
      actorId: 'user-1',
    })

    expect(result.isOk()).toBe(true)
    expect(mocks.deleteToolPermissionGrant).toHaveBeenCalledWith(
      {},
      {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        connectorId: 'github',
        toolName: 'list_issues',
        actorId: 'user-1',
      },
    )
  })
})
