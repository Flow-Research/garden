import { describe, expect, it } from 'vitest'
import {
  nextGitHubAssignee,
  planGitHubWebhookIssueApply,
} from './github-webhook-apply'
import { connectorCommentActorLabel } from '@garden/server/issues/server'
import type { GitHubWebhookIssueTarget } from './github-webhook-resolve'

function target(
  overrides: Partial<GitHubWebhookIssueTarget>,
): GitHubWebhookIssueTarget {
  return {
    installationId: '1',
    githubRepoId: 7,
    owner: 'Flow-Research',
    repo: 'garden',
    issueNumber: 42,
    htmlUrl: 'https://github.com/Flow-Research/garden/issues/42',
    action: 'edited',
    title: 'Title',
    body: 'Body',
    state: 'open',
    stateReason: null,
    labels: [],
    assignees: [],
    senderLogin: 'octocat',
    updatedAtMs: Date.parse('2026-04-01T12:00:00Z'),
    ...overrides,
  }
}

describe('planGitHubWebhookIssueApply', () => {
  it('maps edited to title and description', () => {
    expect(planGitHubWebhookIssueApply(target({ action: 'edited' }))).toEqual({
      title: 'Title',
      description: 'Body',
    })
  })

  it('syncs a cleared body without touching a missing title', () => {
    expect(
      planGitHubWebhookIssueApply(
        target({ action: 'edited', title: null, body: null }),
      ),
    ).toEqual({ description: null })
  })

  it('maps closed to done or cancelled by reason, and reopened to todo', () => {
    expect(planGitHubWebhookIssueApply(target({ action: 'closed' }))).toEqual({
      status: 'done',
    })
    expect(
      planGitHubWebhookIssueApply(
        target({ action: 'closed', stateReason: 'not_planned' }),
      ),
    ).toEqual({ status: 'cancelled' })
    expect(planGitHubWebhookIssueApply(target({ action: 'reopened' }))).toEqual(
      { status: 'todo' },
    )
  })

  it('syncs current labels and assignees, and patches nothing on opened', () => {
    const assignees = [{ id: '7', login: 'octocat' }]
    expect(
      planGitHubWebhookIssueApply(target({ action: 'unassigned', assignees })),
    ).toEqual({ assignees })
    expect(
      planGitHubWebhookIssueApply(
        target({ action: 'labeled', labels: ['bug'] }),
      ),
    ).toEqual({ labels: ['bug'] })
    expect(planGitHubWebhookIssueApply(target({ action: 'opened' }))).toEqual(
      {},
    )
  })

  it('returns null for unsupported actions', () => {
    expect(
      planGitHubWebhookIssueApply(target({ action: 'deleted' })),
    ).toBeNull()
  })
})

describe('nextGitHubAssignee', () => {
  it('assigns the matched member, clears a human, and keeps an agent', () => {
    const human = { assigneeType: 'user', assigneeId: 'u1' }
    const agent = { assigneeType: 'agent', assigneeId: 'a1' }
    expect(nextGitHubAssignee({ current: agent, matchedUserId: 'u2' })).toEqual(
      { assigneeType: 'user', assigneeId: 'u2' },
    )
    expect(nextGitHubAssignee({ current: human, matchedUserId: null })).toEqual(
      { assigneeType: null, assigneeId: null },
    )
    expect(nextGitHubAssignee({ current: agent, matchedUserId: null })).toEqual(
      agent,
    )
  })
})

describe('connectorCommentActorLabel', () => {
  it('formats GitHub login when present', () => {
    expect(connectorCommentActorLabel({ github_login: 'octocat' })).toBe(
      'GitHub · @octocat',
    )
  })

  it('falls back to GitHub without login', () => {
    expect(connectorCommentActorLabel(null)).toBe('GitHub')
    expect(connectorCommentActorLabel({})).toBe('GitHub')
  })
})
