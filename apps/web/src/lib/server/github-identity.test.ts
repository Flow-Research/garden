import { describe, expect, it, vi } from 'vitest'
import { createGitHubSetupState, resolveGitHubSetupState } from './github-app'
import {
  buildGitHubUserAuthorizeUrl,
  fetchVerifiedGitHubUser,
  identityOutcomeForError,
} from './github-identity'

const secret = 'test-secret'
const base = { secret, userId: 'user-1', workspaceId: 'ws-1' }

describe('GitHub state purpose', () => {
  it('round-trips an identity state', async () => {
    const state = await createGitHubSetupState({ ...base, purpose: 'identity' })
    const resolved = await resolveGitHubSetupState({
      secret,
      state,
      purpose: 'identity',
    })
    expect(resolved.isOk() && resolved.value.userId).toBe('user-1')
  })

  it('rejects an install state on the identity flow', async () => {
    const state = await createGitHubSetupState(base)
    const resolved = await resolveGitHubSetupState({
      secret,
      state,
      purpose: 'identity',
    })
    expect(resolved.isErr()).toBe(true)
  })

  it('rejects an identity state on the install flow', async () => {
    const state = await createGitHubSetupState({ ...base, purpose: 'identity' })
    const resolved = await resolveGitHubSetupState({ secret, state })
    expect(resolved.isErr()).toBe(true)
  })

  it('rejects an expired identity state', async () => {
    vi.useFakeTimers()
    const state = await createGitHubSetupState({ ...base, purpose: 'identity' })
    vi.advanceTimersByTime(16 * 60 * 1000)
    const resolved = await resolveGitHubSetupState({
      secret,
      state,
      purpose: 'identity',
    })
    vi.useRealTimers()
    expect(resolved.isErr()).toBe(true)
  })
})

describe('buildGitHubUserAuthorizeUrl', () => {
  it('targets GitHub authorize with client, redirect and state', () => {
    const url = new URL(
      buildGitHubUserAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://garden.test/api/github/callback',
        state: 's',
      }),
    )
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    )
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://garden.test/api/github/callback',
    )
    expect(url.searchParams.get('state')).toBe('s')
  })
})

describe('fetchVerifiedGitHubUser', () => {
  const args = {
    clientId: 'cid',
    clientSecret: 'csecret',
    code: 'code-1',
    redirectUri: 'https://garden.test/api/github/callback',
  }

  it('returns the verified id and login', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'tok' }))
      .mockResolvedValueOnce(Response.json({ id: 42, login: 'octo' }))
    const result = await fetchVerifiedGitHubUser({ ...args, fetcher })
    expect(result.isOk() && result.value).toEqual({
      githubUserId: '42',
      githubLogin: 'octo',
    })
    expect(fetcher.mock.calls[1]?.[1]?.headers.Authorization).toBe('Bearer tok')
  })

  it('fails when GitHub rejects the code (200 with error body)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'bad_verification_code' }))
    const result = await fetchVerifiedGitHubUser({ ...args, fetcher })
    expect(result.isErr() && result.error.code).toBe('exchange_failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails when the user lookup is rejected', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'tok' }))
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
    const result = await fetchVerifiedGitHubUser({ ...args, fetcher })
    expect(result.isErr() && result.error.code).toBe('user_fetch_failed')
  })
})

describe('identityOutcomeForError', () => {
  it('maps a taken account to taken and everything else to failed', () => {
    expect(identityOutcomeForError({ code: 'identity_taken' })).toBe('taken')
    expect(identityOutcomeForError({ code: 'exchange_failed' })).toBe('failed')
  })
})
