import { describe, expect, it } from 'vitest'
import type { IssueStatus } from '../types/issue'
import type { IssueRunStatus } from '../types/issue-run'
import {
  canAgentSelfManageIssueStatus,
  canResumeWaitingRun,
  cancelLiveRunsOnIssueChange,
  nextIssueStatusForRunStatus,
  shouldSkipIssueRunStart,
} from './run-sync'

describe('nextIssueStatusForRunStatus', () => {
  const rows: Array<{
    runStatus: IssueRunStatus
    issueStatus: IssueStatus
    expected: IssueStatus | null
  }> = [
    { runStatus: 'queued', issueStatus: 'todo', expected: null },
    { runStatus: 'running', issueStatus: 'todo', expected: 'in_progress' },
    { runStatus: 'waiting_for_input', issueStatus: 'todo', expected: null },
    {
      runStatus: 'waiting_for_approval',
      issueStatus: 'in_progress',
      expected: 'in_review',
    },
    { runStatus: 'succeeded', issueStatus: 'in_review', expected: null },
    { runStatus: 'failed', issueStatus: 'in_progress', expected: null },
    { runStatus: 'cancelled', issueStatus: 'in_progress', expected: null },
    { runStatus: 'blocked', issueStatus: 'in_progress', expected: 'blocked' },
  ]

  it.each(rows)('$runStatus maps from $issueStatus to $expected', (row) => {
    expect(nextIssueStatusForRunStatus(row.runStatus, row.issueStatus)).toBe(
      row.expected,
    )
  })
})

describe('canAgentSelfManageIssueStatus', () => {
  it.each([
    ['todo', true],
    ['in_progress', true],
    ['in_review', true],
    ['done', true],
    ['blocked', true],
    ['cancelled', false],
  ] as const)('returns %s for %s', (status, expected) => {
    expect(canAgentSelfManageIssueStatus(status)).toBe(expected)
  })
})

describe('shouldSkipIssueRunStart', () => {
  it('skips terminal issues', () => {
    expect(
      shouldSkipIssueRunStart({
        issueStatus: 'done',
        source: 'manual',
      }),
    ).toBe('terminal_issue')
  })

  it('does not start an agent merely because a todo issue was assigned', () => {
    expect(
      shouldSkipIssueRunStart({
        issueStatus: 'todo',
        source: 'assignment',
      }),
    ).toBe('todo_assignment')
  })
})

describe('canResumeWaitingRun', () => {
  it('allows comments to resume the same agent waiting for input', () => {
    expect(
      canResumeWaitingRun({
        agentId: 'agent-1',
        runAgentId: 'agent-1',
        runStatus: 'waiting_for_input',
        source: 'comment',
      }),
    ).toBe(true)
  })

  it('does not resume approval waits or a different agent run', () => {
    expect(
      canResumeWaitingRun({
        agentId: 'agent-2',
        runAgentId: 'agent-1',
        runStatus: 'waiting_for_approval',
        source: 'comment',
      }),
    ).toBe(false)
  })
})

describe('cancelLiveRunsOnIssueChange', () => {
  it('cancels live runs when an issue is moved to done', () => {
    expect(
      cancelLiveRunsOnIssueChange({
        currentStatus: 'in_progress',
        nextStatus: 'done',
        currentAssigneeType: 'agent',
        currentAssigneeId: 'agent-1',
        nextAssigneeType: 'agent',
        nextAssigneeId: 'agent-1',
      }).cancelLiveRuns,
    ).toBe(true)
  })

  it('cancels old assignee runs without waking the new agent while still todo', () => {
    expect(
      cancelLiveRunsOnIssueChange({
        currentStatus: 'todo',
        nextStatus: 'todo',
        currentAssigneeType: 'agent',
        currentAssigneeId: 'agent-1',
        nextAssigneeType: 'agent',
        nextAssigneeId: 'agent-2',
      }),
    ).toEqual({
      cancelLiveRuns: true,
      cancelAgentId: 'agent-1',
      shouldWakeAgent: false,
    })
  })

  it('wakes the assigned agent when work moves into progress', () => {
    expect(
      cancelLiveRunsOnIssueChange({
        currentStatus: 'todo',
        nextStatus: 'in_progress',
        currentAssigneeType: 'agent',
        currentAssigneeId: 'agent-1',
        nextAssigneeType: 'agent',
        nextAssigneeId: 'agent-1',
      }).shouldWakeAgent,
    ).toBe(true)
  })
})
