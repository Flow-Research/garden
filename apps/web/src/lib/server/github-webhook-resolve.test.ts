import { describe, expect, it } from 'vitest'
import {
  githubIssueExternalIdCandidates,
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
})
