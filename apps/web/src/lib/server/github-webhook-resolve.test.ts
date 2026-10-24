import { describe, expect, it } from 'vitest'
import {
  githubIssueExternalIdCandidates,
  parseGitHubWebhookCommentTarget,
  parseGitHubWebhookIssueTarget,
} from './github-webhook-resolve'

describe('githubIssueExternalIdCandidates', () => {
  it('includes canonical owner/repo/issues/n form', () => {
    expect(
      githubIssueExternalIdCandidates({
        owner: 'Flow-Research',
        repo: 'garden',
        issueNumber: 42,
        htmlUrl: 'https://github.com/Flow-Research/garden/issues/42',
      }),
    ).toEqual([
      'Flow-Research/garden/issues/42',
      'Flow-Research/garden#42',
      'https://github.com/Flow-Research/garden/issues/42',
    ])
  })
})

describe('parseGitHubWebhookIssueTarget', () => {
  it('returns null for deliveries without an issue object', () => {
    const result = parseGitHubWebhookIssueTarget({
      zen: 'Design for failure.',
      hook_id: 1,
    })
    expect(result.isOk() && result.value).toBeNull()
  })

  it('parses installation, repo, and issue fields', () => {
    const result = parseGitHubWebhookIssueTarget({
      action: 'edited',
      installation: { id: 155955068 },
      repository: {
        name: 'garden',
        full_name: 'Flow-Research/garden',
        owner: { login: 'Flow-Research' },
      },
      issue: {
        number: 42,
        title: 'Webhook sync',
        body: 'hello',
        state: 'open',
        html_url: 'https://github.com/Flow-Research/garden/issues/42',
      },
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error
    expect(result.value).toEqual({
      installationId: '155955068',
      owner: 'Flow-Research',
      repo: 'garden',
      issueNumber: 42,
      htmlUrl: 'https://github.com/Flow-Research/garden/issues/42',
      action: 'edited',
      title: 'Webhook sync',
      body: 'hello',
      state: 'open',
      senderType: null,
    })
  })

  it('rejects issue events missing installation or number', () => {
    const result = parseGitHubWebhookIssueTarget({
      action: 'closed',
      issue: { number: 1 },
      repository: { name: 'garden', owner: { login: 'Flow-Research' } },
    })
    expect(result.isErr() && result.error.code).toBe('invalid_payload')
  })

  it('returns null when payload is an issue_comment delivery', () => {
    const result = parseGitHubWebhookIssueTarget({
      action: 'created',
      installation: { id: 1 },
      repository: {
        name: 'garden',
        full_name: 'Flow-Research/garden',
        owner: { login: 'Flow-Research' },
      },
      issue: {
        number: 42,
        html_url: 'https://github.com/Flow-Research/garden/issues/42',
      },
      comment: { id: 99, body: 'hi' },
    })
    expect(result.isOk() && result.value).toBeNull()
  })
})

describe('parseGitHubWebhookCommentTarget', () => {
  it('returns null when comment is absent', () => {
    const result = parseGitHubWebhookCommentTarget({
      action: 'edited',
      issue: { number: 1 },
    })
    expect(result.isOk() && result.value).toBeNull()
  })

  it('parses comment identity and author fields', () => {
    const result = parseGitHubWebhookCommentTarget({
      action: 'created',
      installation: { id: 155955068 },
      repository: {
        name: 'garden',
        full_name: 'Flow-Research/garden',
        owner: { login: 'Flow-Research' },
      },
      issue: {
        number: 42,
        html_url: 'https://github.com/Flow-Research/garden/issues/42',
      },
      comment: {
        id: 987654321,
        body: 'from github',
        html_url:
          'https://github.com/Flow-Research/garden/issues/42#issuecomment-987654321',
        created_at: '2026-04-01T12:00:00Z',
        user: { id: 42, login: 'octocat', type: 'User' },
      },
      sender: { type: 'User' },
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error
    expect(result.value).toEqual({
      installationId: '155955068',
      owner: 'Flow-Research',
      repo: 'garden',
      issueNumber: 42,
      htmlUrl: 'https://github.com/Flow-Research/garden/issues/42',
      action: 'created',
      commentId: '987654321',
      body: 'from github',
      commentHtmlUrl:
        'https://github.com/Flow-Research/garden/issues/42#issuecomment-987654321',
      githubLogin: 'octocat',
      githubUserId: '42',
      senderType: 'User',
      createdAt: new Date('2026-04-01T12:00:00Z'),
    })
  })
})
