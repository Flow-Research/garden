import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import { applyIssueMutationSideEffects } from './issue-mutation-effects'

const mocks = vi.hoisted(() => ({
  archiveTerminalIssueInbox: vi.fn(async () => undefined),
  cancelLiveRunsOnIssueChange: vi.fn(),
  cancelIssueRun: vi.fn(),
  startIssueRun: vi.fn(),
  publishWorkspaceEvent: vi.fn(async () => undefined),
  getWorkspaceIssuePrefix: vi.fn(async () => 'GDN'),
  toIssue: vi.fn((row: { id: string }) => ({ id: row.id, title: 't' })),
}))

vi.mock('@garden/db/inbox', () => ({
  archiveTerminalIssueInbox: mocks.archiveTerminalIssueInbox,
}))

vi.mock('@garden/core/issues/run-sync', () => ({
  LIVE_RUN_STATUSES: ['queued', 'running', 'waiting_for_input'],
  cancelLiveRunsOnIssueChange: mocks.cancelLiveRunsOnIssueChange,
}))

vi.mock('@garden/server/issues/run-service', () => ({
  cancelIssueRun: mocks.cancelIssueRun,
  startIssueRun: mocks.startIssueRun,
}))

vi.mock('@/lib/server/realtime', () => ({
  publishWorkspaceEvent: mocks.publishWorkspaceEvent,
}))

vi.mock('@/lib/server/control-plane', () => ({
  getWorkspaceIssuePrefix: mocks.getWorkspaceIssuePrefix,
  toIssue: mocks.toIssue,
}))

describe('applyIssueMutationSideEffects', () => {
  beforeEach(() => {
    mocks.archiveTerminalIssueInbox.mockClear()
    mocks.cancelLiveRunsOnIssueChange.mockReset()
    mocks.cancelIssueRun.mockReset()
    mocks.startIssueRun.mockReset()
    mocks.publishWorkspaceEvent.mockClear()
    mocks.cancelLiveRunsOnIssueChange.mockReturnValue({
      cancelLiveRuns: true,
      cancelAgentId: null,
      shouldWakeAgent: false,
    })
    mocks.cancelIssueRun.mockResolvedValue(Result.ok(undefined))
  })

  it('archives inbox and cancels live runs on close to done', async () => {
    const waitUntil = vi.fn()
    const where = vi.fn(async () => [{ id: 'run-1' }, { id: 'run-2' }])
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where,
        })),
      })),
    }

    await applyIssueMutationSideEffects({
      db: db as never,
      env: {} as never,
      waitUntil,
      workspaceId: 'ws-1',
      previous: {
        status: 'todo',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
      },
      nextIssue: {
        id: 'issue-1',
        status: 'done',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
      } as never,
      actor: { type: 'system', id: 'github-webhook' },
      wakeOnAssignment: false,
    })

    expect(mocks.archiveTerminalIssueInbox).toHaveBeenCalledWith({
      db,
      workspaceId: 'ws-1',
      issueId: 'issue-1',
    })
    expect(mocks.cancelIssueRun).toHaveBeenCalledTimes(2)
    expect(mocks.cancelIssueRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: 'run-1',
        reason: 'issue_changed',
        actor: { type: 'system', id: 'github-webhook' },
      }),
    )
    expect(waitUntil).toHaveBeenCalled()
    expect(mocks.publishWorkspaceEvent).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      expect.objectContaining({ type: 'issue:updated' }),
    )
  })

  it('does not archive inbox on reopen to todo', async () => {
    mocks.cancelLiveRunsOnIssueChange.mockReturnValue({
      cancelLiveRuns: false,
      cancelAgentId: null,
      shouldWakeAgent: false,
    })
    const waitUntil = vi.fn()
    await applyIssueMutationSideEffects({
      db: {
        select: vi.fn(),
      } as never,
      env: {} as never,
      waitUntil,
      workspaceId: 'ws-1',
      previous: { status: 'done', assigneeType: null, assigneeId: null },
      nextIssue: {
        id: 'issue-1',
        status: 'todo',
        assigneeType: null,
        assigneeId: null,
      } as never,
      actor: { type: 'system', id: 'github-webhook' },
    })

    expect(mocks.archiveTerminalIssueInbox).not.toHaveBeenCalled()
    expect(mocks.cancelIssueRun).not.toHaveBeenCalled()
    expect(mocks.publishWorkspaceEvent).toHaveBeenCalled()
  })
})
