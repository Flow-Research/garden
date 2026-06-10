import { describe, expect, it } from 'vitest'
import { decideWakeups, type WakeupTriggerInput } from './triggers'

const assignee = '00000000-0000-0000-0000-000000000001'
const researcher = '00000000-0000-0000-0000-000000000002'
const member = '00000000-0000-0000-0000-000000000003'
const otherMember = '00000000-0000-0000-0000-000000000004'

function input(overrides: Partial<WakeupTriggerInput> = {}): WakeupTriggerInput {
  return {
    issue: {
      id: 'issue-1',
      status: 'todo',
      assigneeType: 'agent',
      assigneeId: assignee,
    },
    comment: {
      id: 'comment-1',
      authorType: 'user',
      authorId: member,
      body: 'ping',
      parentId: null,
    },
    parentComment: null,
    runningRuns: [],
    mentionedAgentIds: [],
    ...overrides,
  }
}

describe('decideWakeups', () => {
  it('skips terminal issue statuses', () => {
    expect(decideWakeups(input({ issue: { ...input().issue, status: 'done' } }))).toEqual([
      { kind: 'skip', reason: 'terminal_status' },
    ])
    expect(
      decideWakeups(input({ issue: { ...input().issue, status: 'cancelled' } })),
    ).toEqual([{ kind: 'skip', reason: 'terminal_status' }])
  })

  it('skips blocked issues', () => {
    expect(
      decideWakeups(input({ issue: { ...input().issue, status: 'blocked' } })),
    ).toEqual([{ kind: 'skip', reason: 'blocked_issue' }])
  })

  it('wakes the assigned agent on a member-authored top-level comment', () => {
    expect(decideWakeups(input())).toEqual([
      { kind: 'enqueue', agentId: assignee, source: 'comment' },
    ])
  })

  it('wakes mentioned agents independently of the assignee', () => {
    expect(decideWakeups(input({ mentionedAgentIds: [researcher] }))).toEqual([
      { kind: 'enqueue', agentId: assignee, source: 'comment' },
      { kind: 'enqueue', agentId: researcher, source: 'mention' },
    ])
  })

  it('treats a mentioned assignee as a mention source once', () => {
    expect(decideWakeups(input({ mentionedAgentIds: [assignee] }))).toEqual([
      { kind: 'enqueue', agentId: assignee, source: 'mention' },
    ])
  })

  it('skips self-authored agent comments', () => {
    expect(
      decideWakeups(
        input({
          comment: {
            id: 'comment-1',
            authorType: 'agent',
            authorId: assignee,
            body: 'done',
            parentId: null,
          },
        }),
      ),
    ).toEqual([{ kind: 'skip', reason: 'self_authored' }])
  })

  it('skips assignee wakeups on member side threads', () => {
    expect(
      decideWakeups(
        input({
          parentComment: { authorType: 'user', authorId: otherMember },
        }),
      ),
    ).toEqual([{ kind: 'skip', reason: 'sidebar_thread' }])
  })

  it('allows replies to an agent-authored parent comment', () => {
    expect(
      decideWakeups(
        input({
          parentComment: { authorType: 'agent', authorId: assignee },
        }),
      ),
    ).toEqual([{ kind: 'enqueue', agentId: assignee, source: 'comment' }])
  })

  it('dedupes agents with active runs', () => {
    expect(
      decideWakeups(
        input({
          runningRuns: [{ agentId: assignee }, { agentId: researcher }],
          mentionedAgentIds: [researcher],
        }),
      ),
    ).toEqual([
      { kind: 'skip', reason: 'duplicate_pending' },
      { kind: 'skip', reason: 'duplicate_pending' },
    ])
  })

  it('returns no_eligible_agent when no candidate exists', () => {
    expect(
      decideWakeups(
        input({
          issue: {
            id: 'issue-1',
            status: 'todo',
            assigneeType: null,
            assigneeId: null,
          },
        }),
      ),
    ).toEqual([{ kind: 'skip', reason: 'no_eligible_agent' }])
  })
})
