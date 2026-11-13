import { describe, expect, it } from 'vitest'
import { Route } from './callback'

function callback(query: string) {
  const handlers = Route.options.server?.handlers
  if (!handlers || typeof handlers === 'function' || !handlers.GET) {
    throw new Error('Expected GitHub callback GET handler')
  }
  const get = handlers.GET as (args: { request: Request }) => Promise<Response>
  return get({
    request: new Request(`https://garden.test/api/github/callback?${query}`),
  })
}

describe('GitHub App callback', () => {
  it('forwards a user-authorization code to the identity completion route', async () => {
    const response = await callback('code=abc&state=s1')
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/api/github/identity/complete')
    expect(location.searchParams.get('code')).toBe('abc')
    expect(location.searchParams.get('state')).toBe('s1')
  })

  it('keeps sending installs to setup, even when GitHub adds a code', async () => {
    const response = await callback(
      'installation_id=9&setup_action=install&state=s2&code=abc',
    )
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/api/github/setup')
    expect(location.searchParams.get('installation_id')).toBe('9')
    expect(location.searchParams.get('code')).toBeNull()
  })
})
