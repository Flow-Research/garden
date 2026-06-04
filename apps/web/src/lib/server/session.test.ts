import { describe, expect, it, vi } from 'vitest'
import { getAuthSession } from './session'

const mockGetSession = vi.hoisted(() => vi.fn())
const mockCreateAuth = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  createAuth: mockCreateAuth,
}))

const env = {
  DATABASE_URL: 'postgres://garden.test/db',
  BETTER_AUTH_SECRET: 'test-secret',
  BETTER_AUTH_URL: 'https://garden.test',
}

describe('getAuthSession', () => {
  it('passes the original request into Better Auth session resolution', async () => {
    const request = new Request('https://garden-staging.example/workspace', {
      headers: { cookie: '__Secure-better-auth.session_token=test-token' },
    })
    const session = {
      session: { id: 'session-id' },
      user: { id: 'user-id' },
    }

    mockGetSession.mockResolvedValueOnce(session)
    mockCreateAuth.mockReturnValueOnce({
      api: { getSession: mockGetSession },
    })

    const result = await getAuthSession(request, env)

    expect(result).toBe(session)
    expect(mockCreateAuth).toHaveBeenCalledWith(env, request)
    expect(mockGetSession).toHaveBeenCalledWith({ headers: request.headers })
  })

  it('returns null when Better Auth has no complete session', async () => {
    const request = new Request('https://garden-staging.example/workspace')

    mockGetSession.mockResolvedValueOnce({ session: null, user: null })
    mockCreateAuth.mockReturnValueOnce({
      api: { getSession: mockGetSession },
    })

    await expect(getAuthSession(request, env)).resolves.toBeNull()
  })
})
