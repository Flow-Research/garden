import type { IssueAssigneeType, IssueStatus } from '../types/issue'

export type WakeupTriggerInput = {
  issue: {
    id: string
    status: IssueStatus
    assigneeType: IssueAssigneeType | null
    assigneeId: string | null
  }
  comment: {
    id: string
    authorType: 'user' | 'agent'
    authorId: string
    body: string
    parentId: string | null
  }
  parentComment: { authorType: 'user' | 'agent'; authorId: string } | null
  runningRuns: { agentId: string }[]
  mentionedAgentIds: string[]
}

export type WakeupDecision =
  | { kind: 'enqueue'; agentId: string; source: 'comment' | 'mention' }
  | {
      kind: 'skip'
      reason:
        | 'terminal_status'
        | 'blocked_issue'
        | 'self_authored'
        | 'sidebar_thread'
        | 'duplicate_pending'
        | 'no_eligible_agent'
    }

type Candidate = {
  agentId: string
  mentioned: boolean
  assignee: boolean
}

function uniqueCandidates(input: WakeupTriggerInput) {
  const candidates = new Map<string, Candidate>()
  if (input.issue.assigneeType === 'agent' && input.issue.assigneeId) {
    candidates.set(input.issue.assigneeId, {
      agentId: input.issue.assigneeId,
      mentioned: false,
      assignee: true,
    })
  }

  for (const agentId of input.mentionedAgentIds) {
    const existing = candidates.get(agentId)
    candidates.set(agentId, {
      agentId,
      mentioned: true,
      assignee: existing?.assignee ?? false,
    })
  }

  return [...candidates.values()]
}

export function decideWakeups(input: WakeupTriggerInput): WakeupDecision[] {
  if (input.issue.status === 'done' || input.issue.status === 'cancelled') {
    return [{ kind: 'skip', reason: 'terminal_status' }]
  }

  if (input.issue.status === 'blocked') {
    return [{ kind: 'skip', reason: 'blocked_issue' }]
  }

  const busyAgentIds = new Set(input.runningRuns.map((run) => run.agentId))
  const decisions: WakeupDecision[] = []

  for (const candidate of uniqueCandidates(input)) {
    if (
      input.comment.authorType === 'agent' &&
      input.comment.authorId === candidate.agentId
    ) {
      decisions.push({ kind: 'skip', reason: 'self_authored' })
      continue
    }

    if (
      candidate.assignee &&
      !candidate.mentioned &&
      input.parentComment?.authorType === 'user'
    ) {
      decisions.push({ kind: 'skip', reason: 'sidebar_thread' })
      continue
    }

    if (busyAgentIds.has(candidate.agentId)) {
      decisions.push({ kind: 'skip', reason: 'duplicate_pending' })
      continue
    }

    decisions.push({
      kind: 'enqueue',
      agentId: candidate.agentId,
      source: candidate.mentioned ? 'mention' : 'comment',
    })
  }

  return decisions.length > 0
    ? decisions
    : [{ kind: 'skip', reason: 'no_eligible_agent' }]
}
