import { describe, expect, it } from 'vitest'
import { memberGithubIdentity } from './member-github-identity'

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
