// @vitest-environment node
import { Result } from 'better-result'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecideAnalysisSnapshot } from '@garden/agent-runtime/src/decide-analysis-types'

const requireWorkspaceMember = vi.hoisted(() => vi.fn())
const service = vi.hoisted(() => ({
  readDecideAnalysis: vi.fn(),
  cancelDecideAnalysis: vi.fn(),
  retryDecideAnalysis: vi.fn(),
}))

vi.mock('@/lib/server/workspace-permissions', () => ({
  requireWorkspaceMember,
  workspacePermissions: { automationManage: { automation: ['manage'] } },
}))
vi.mock('@/lib/server/env', () => ({ appEnv: {} }))
vi.mock('@/lib/server/decide-analysis/service', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  ...service,
}))

const { getDecideAnalysisStatus, postDecideAnalysisAction } =
  await import('./decide-analyses/$runId')

const RUN_ID = '2f9d1c66-9b5e-4c8e-9a51-0c7a3c3d7e10'

const snapshot = (
  owner: DecideAnalysisSnapshot['owner'],
): DecideAnalysisSnapshot => ({
  runId: RUN_ID,
  workspaceId: 'workspace-1',
  ownerUserId: 'agent-owner',
  owner,
  status: 'running',
  attempt: 1,
  progress: null,
  providerSessionId: 'sess_secret',
  result: null,
  error: null,
  cancelRequestedAt: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  startedAt: null,
  completedAt: null,
  deliveredAt: null,
})

const automationOwner = {
  kind: 'automation_run' as const,
  automationRunId: 'automation-run-1',
}
const request = () =>
  ({
    request: new Request('http://localhost/api/decide-analyses/x'),
  }) as never
const memberAs = (userId: string) =>
  requireWorkspaceMember.mockResolvedValue({
    session: { user: { id: userId } },
    membership: { organizationId: 'workspace-1', role: 'member' },
  })

describe('owner-agnostic Decide analysis route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets any workspace member read an automation-owned run', async () => {
    service.readDecideAnalysis.mockResolvedValue(
      Result.ok(snapshot(automationOwner)),
    )
    memberAs('teammate')

    const response = await getDecideAnalysisStatus(request(), RUN_ID)

    expect(response.status).toBe(200)
    expect(requireWorkspaceMember).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      undefined,
    )
    const body = await response.json()
    expect(body).toMatchObject({ runId: RUN_ID, status: 'running' })
    expect(JSON.stringify(body)).not.toContain('sess_secret')
  })

  it('hides a chat run from workspace members who do not own the thread', async () => {
    service.readDecideAnalysis.mockResolvedValue(
      Result.ok(snapshot({ kind: 'chat', threadId: 'thread-1' })),
    )
    memberAs('teammate')

    const response = await getDecideAnalysisStatus(request(), RUN_ID)

    expect(response.status).toBe(404)
  })

  it('refuses callers outside the run workspace', async () => {
    service.readDecideAnalysis.mockResolvedValue(
      Result.ok(snapshot(automationOwner)),
    )
    requireWorkspaceMember.mockResolvedValue(
      Response.json({ error: 'Workspace access denied' }, { status: 403 }),
    )

    const response = await getDecideAnalysisStatus(request(), RUN_ID)

    expect(response.status).toBe(403)
  })

  it('cancels as the run owner when the caller may manage automations', async () => {
    const run = snapshot(automationOwner)
    service.readDecideAnalysis.mockResolvedValue(Result.ok(run))
    service.cancelDecideAnalysis.mockResolvedValue(
      Result.ok({ ...run, status: 'cancel_requested' }),
    )
    memberAs('teammate')

    const response = await postDecideAnalysisAction(
      {
        request: new Request('http://localhost/api/decide-analyses/x', {
          method: 'POST',
          body: JSON.stringify({ action: 'cancel' }),
        }),
      } as never,
      RUN_ID,
    )

    expect(response.status).toBe(200)
    expect(requireWorkspaceMember).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      { automation: ['manage'] },
    )
    expect(service.cancelDecideAnalysis).toHaveBeenCalledWith(
      {},
      {
        workspaceId: 'workspace-1',
        ownerUserId: 'agent-owner',
        owner: automationOwner,
      },
      RUN_ID,
    )
  })
})
