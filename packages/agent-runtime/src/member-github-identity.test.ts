import { describe, expect, it } from 'vitest'
import {
  memberGithubIdentity,
  resolveGithubIssueAssignees,
} from './member-github-identity'

describe('memberGithubIdentity', () => {
  it('returns linked when both id and login are present', () => {
    expect(
      memberGithubIdentity({
        githubUserId: '12345',
        githubLogin: 'octocat',
      }),
    ).toEqual({
      status: 'linked',
      user_id: '12345',
      login: 'octocat',
    })
  })

  it('returns not_linked when either field is missing', () => {
    expect(
      memberGithubIdentity({ githubUserId: null, githubLogin: null }),
    ).toEqual({ status: 'not_linked' })
    expect(
      memberGithubIdentity({ githubUserId: '1', githubLogin: null }),
    ).toEqual({ status: 'not_linked' })
    expect(
      memberGithubIdentity({ githubUserId: null, githubLogin: 'octocat' }),
    ).toEqual({ status: 'not_linked' })
  })
})

describe('resolveGithubIssueAssignees', () => {
  it('returns logins for linked members', () => {
    expect(
      resolveGithubIssueAssignees([
        {
          label: 'Ada',
          github_identity: {
            status: 'linked',
            user_id: '1',
            login: 'ada',
          },
        },
        {
          label: 'Grace',
          github_identity: {
            status: 'linked',
            user_id: '2',
            login: 'grace',
          },
        },
      ]),
    ).toEqual({ ok: true, assignees: ['ada', 'grace'] })
  })

  it('fails with explicit not_linked instead of inventing handles', () => {
    const result = resolveGithubIssueAssignees([
      {
        label: 'Ada',
        github_identity: {
          status: 'linked',
          user_id: '1',
          login: 'ada',
        },
      },
      {
        label: 'Unlinked User',
        github_identity: { status: 'not_linked' },
      },
      {
        label: 'Also Missing',
        github_identity: { status: 'not_linked' },
      },
    ])
    expect(result).toMatchObject({
      ok: false,
      status: 'not_linked',
      not_linked: ['Unlinked User', 'Also Missing'],
    })
    if (result.ok) throw new Error('expected not_linked failure')
    expect(result.message).toContain('Unlinked User')
    expect(result.message).toContain('Also Missing')
    expect(result.message).not.toMatch(/invent|guess|assume/i)
  })

  it('returns empty assignees for an empty candidate list', () => {
    expect(resolveGithubIssueAssignees([])).toEqual({
      ok: true,
      assignees: [],
    })
  })
})
