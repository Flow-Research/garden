import { describe, expect, it } from 'vitest'
import {
  checkGithubIssueAssignees,
  memberGithubIdentity,
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

describe('checkGithubIssueAssignees', () => {
  it('allows logins linked to workspace members, ignoring case', () => {
    expect(
      checkGithubIssueAssignees({
        requested: ['Ada', 'grace'],
        linkedLogins: ['ada', 'Grace'],
      }),
    ).toEqual({ status: 'allowed' })
  })

  it('rejects logins no workspace member has linked', () => {
    const result = checkGithubIssueAssignees({
      requested: ['ada', 'stranger', 'also-unknown'],
      linkedLogins: ['ada'],
    })
    expect(result).toMatchObject({
      status: 'unlinked',
      logins: ['stranger', 'also-unknown'],
    })
    if (result.status !== 'unlinked') throw new Error('expected unlinked')
    expect(result.message).toContain('stranger')
  })

  it('rejects everything when nobody in the workspace is linked', () => {
    expect(
      checkGithubIssueAssignees({ requested: ['ada'], linkedLogins: [] }),
    ).toMatchObject({ status: 'unlinked', logins: ['ada'] })
  })
})
