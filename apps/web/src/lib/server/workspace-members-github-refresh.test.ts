import { describe, expect, it } from 'vitest'
import { classifyGithubIdentityWrite } from './workspace-members'

describe('classifyGithubIdentityWrite', () => {
  it('classifies unlink, link, and rename refresh by stable user id', () => {
    expect(
      classifyGithubIdentityWrite({
        existingGithubUserId: '1',
        nextGithubUserId: null,
        nextGithubLogin: null,
      }),
    ).toBe('unlink')

    expect(
      classifyGithubIdentityWrite({
        existingGithubUserId: null,
        nextGithubUserId: '1',
        nextGithubLogin: 'octocat',
      }),
    ).toBe('link')

    expect(
      classifyGithubIdentityWrite({
        existingGithubUserId: '1',
        nextGithubUserId: '1',
        nextGithubLogin: 'octocat-renamed',
      }),
    ).toBe('refresh_login')

    expect(
      classifyGithubIdentityWrite({
        existingGithubUserId: '1',
        nextGithubUserId: '2',
        nextGithubLogin: 'someone-else',
      }),
    ).toBe('link')
  })

  it('treats clear-from-unlinked as unlink and never keys refresh off login alone', () => {
    expect(
      classifyGithubIdentityWrite({
        existingGithubUserId: null,
        nextGithubUserId: null,
        nextGithubLogin: null,
      }),
    ).toBe('unlink')

    // Same login string with a different id is a new link, not a rename.
    expect(
      classifyGithubIdentityWrite({
        existingGithubUserId: '1',
        nextGithubUserId: '2',
        nextGithubLogin: 'octocat',
      }),
    ).toBe('link')
  })
})
