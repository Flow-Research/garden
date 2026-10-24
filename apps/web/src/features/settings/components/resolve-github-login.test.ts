import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveGithubLogin,
  searchGithubUsers,
} from './resolve-github-login'

describe('resolveGithubLogin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects an empty username', async () => {
    const result = await resolveGithubLogin('   ')
    expect(
      result.match({
        ok: () => null,
        err: (error) => error.message,
      }),
    ).toMatch(/enter a github username/i)
  })

  it('resolves a public GitHub user to id + login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { id: 583231, login: 'octocat', type: 'User' },
          { status: 200 },
        ),
      ),
    )

    const result = await resolveGithubLogin('@octocat')
    expect(
      result.match({
        ok: (value) => value,
        err: (error) => error.message,
      }),
    ).toEqual({
      user_id: '583231',
      login: 'octocat',
    })
  })

  it('rejects organization accounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { id: 9919, login: 'github', type: 'Organization' },
          { status: 200 },
        ),
      ),
    )

    const result = await resolveGithubLogin('github')
    expect(
      result.match({
        ok: () => null,
        err: (error) => error.message,
      }),
    ).toMatch(/not a user/i)
  })

  it('returns not found without inventing a handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Not Found', { status: 404 })),
    )

    const result = await resolveGithubLogin('no-such-user-zzz')
    expect(
      result.match({
        ok: () => null,
        err: (error) => error.message,
      }),
    ).toMatch(/no github user/i)
  })
})

describe('searchGithubUsers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty results for short queries without calling GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchGithubUsers('a')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      result.match({
        ok: (value) => value,
        err: (error) => error.message,
      }),
    ).toEqual([])
  })

  it('maps user search hits and drops organizations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(encodeURIComponent('octo type:user'))
      return Response.json({
        items: [
          {
            id: 1,
            login: 'octocat',
            type: 'User',
            avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
          },
          { id: 2, login: 'octo', type: 'User', avatar_url: null },
          { id: 3, login: 'octo-org', type: 'Organization', avatar_url: null },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchGithubUsers('octo')
    expect(
      result.match({
        ok: (value) => value,
        err: (error) => error.message,
      }),
    ).toEqual([
      {
        user_id: '1',
        login: 'octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      },
      { user_id: '2', login: 'octo', avatar_url: null },
    ])
  })
})
