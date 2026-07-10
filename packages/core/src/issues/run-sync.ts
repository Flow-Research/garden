import type { IssueStatus } from '../types/issue'
import type { IssueRunStatus, IssueRunTriggerSource } from '../types/issue-run'

export const AGENT_SELF_MANAGED_ISSUE_STATUSES = [
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
] as const satisfies IssueStatus[]

export const LIVE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
] as const satisfies IssueRunStatus[]

export const WAKEUP_DEDUPING_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
] as const satisfies IssueRunStatus[]

export const TERMINAL_ISSUE_STATUSES = [
  'done',
  'cancelled',
] as const satisfies IssueStatus[]

export type IssueRunStartTrigger = {
  commentId?: string
  sourceBindingId?: string
  correlationId?: string
}

export type SkipIssueRunStartReason = 'terminal_issue' | 'todo_assignment'

export function nextIssueStatusForRunStatus(
  runStatus: IssueRunStatus,
  currentIssueStatus: IssueStatus,
): IssueStatus | null {
  if (runStatus === 'running' && currentIssueStatus === 'todo') {
    return 'in_progress'
  }

  if (runStatus === 'waiting_for_approval') return 'in_review'
  if (runStatus === 'blocked') return 'blocked'

  return null
}

export function isLiveIssueRunStatus(status: IssueRunStatus) {
  return (LIVE_RUN_STATUSES as readonly IssueRunStatus[]).includes(status)
}

export function isTerminalIssueStatus(status: IssueStatus | null | undefined) {
  return Boolean(
    status &&
    (TERMINAL_ISSUE_STATUSES as readonly IssueStatus[]).includes(status),
  )
}

export function shouldSkipIssueRunStart(input: {
  issueStatus: IssueStatus | null | undefined
  source: IssueRunTriggerSource
}): SkipIssueRunStartReason | null {
  if (isTerminalIssueStatus(input.issueStatus)) return 'terminal_issue'
  if (input.source === 'assignment' && input.issueStatus === 'todo') {
    return 'todo_assignment'
  }
  return null
}

export function canResumeWaitingRun(input: {
  agentId: string
  runAgentId: string
  runStatus: IssueRunStatus
  source: IssueRunTriggerSource
}) {
  return (
    input.runStatus === 'waiting_for_input' &&
    input.runAgentId === input.agentId &&
    (input.source === 'comment' || input.source === 'mention')
  )
}

export function canAgentSelfManageIssueStatus(status: IssueStatus) {
  return (AGENT_SELF_MANAGED_ISSUE_STATUSES as readonly IssueStatus[]).includes(
    status,
  )
}

export function cancelLiveRunsOnIssueChange(input: {
  currentStatus: IssueStatus
  nextStatus: IssueStatus
  currentAssigneeType: 'user' | 'member' | 'agent' | null
  currentAssigneeId: string | null
  nextAssigneeType: 'user' | 'member' | 'agent' | null
  nextAssigneeId: string | null
}) {
  const movedToTerminal =
    input.nextStatus === 'cancelled' || input.nextStatus === 'done'
  const assigneeChanged =
    input.currentAssigneeType !== input.nextAssigneeType ||
    input.currentAssigneeId !== input.nextAssigneeId

  return {
    cancelLiveRuns: movedToTerminal || assigneeChanged,
    cancelAgentId: assigneeChanged ? input.currentAssigneeId : null,
    shouldWakeAgent:
      input.nextAssigneeType === 'agent' &&
      input.nextStatus !== 'todo' &&
      input.nextStatus !== 'done' &&
      input.nextStatus !== 'cancelled',
  }
}
