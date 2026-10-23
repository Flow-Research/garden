import { describe, expect, it } from 'vitest'
import { planGitHubWebhookIssueApply } from './github-webhook-apply'
import type { GitHubWebhookIssueTarget } from './github-webhook-resolve'

function target(
  overrides: Partial<GitHubWebhookIssueTarget>,
): GitHubWebhookIssueTarget {
  return {
    installationId: '1',
    owner: 'Flow-Research',
    repo: 'garden',
    issueNumber: 42,
    htmlUrl: 'https://github.com/Flow-Research/garden/issues/42',
    action: 'edited',
    title: 'Title',
    body: 'Body',
    state: 'open',
    senderType: 'User',
    ...overrides,
  }
}

describe('planGitHubWebhookIssueApply', () => {
  it('maps edited to title and description', () => {
    expect(planGitHubWebhookIssueApply(target({ action: 'edited' }))).toEqual({
      fields: { title: 'Title', description: 'Body' },
      planned: ['title', 'description'],
    })
  })

  it('maps closed to done and reopened to todo', () => {
    expect(planGitHubWebhookIssueApply(target({ action: 'closed' }))).toEqual({
      fields: { status: 'done' },
      planned: ['status'],
    })
    expect(planGitHubWebhookIssueApply(target({ action: 'reopened' }))).toEqual(
      {
        fields: { status: 'todo' },
        planned: ['status'],
      },
    )
  })

  it('returns null for unsupported actions', () => {
    expect(
      planGitHubWebhookIssueApply(target({ action: 'assigned' })),
    ).toBeNull()
  })
})
