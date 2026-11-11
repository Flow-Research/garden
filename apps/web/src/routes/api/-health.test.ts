// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AppRequestContext } from '@/lib/server/context'
import { getHealth } from '@/routes/api/health'

const SECRET_ERROR =
  'connect ECONNREFUSED postgres://garden:hunter2@db.internal:5432/garden'

/**
 * Builds a request context with no session and only a db provider, proving
 * the health route never reaches for auth.
 */
function contextWithDb(execute: () => Promise<unknown>) {
  return {
    db: async () => ({ execute }),
    session: null,
  } as unknown as AppRequestContext
}

describe('GET /api/health', () => {
  it('returns 200 ok when the database answers', async () => {
    const execute = vi.fn(async () => [{ '?column?': 1 }])
    const response = await getHealth({ context: contextWithDb(execute) })

    expect(execute).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { database: 'ok' },
    })
  })

  it('returns 503 degraded without leaking the database error', async () => {
    const execute = vi.fn(async () => {
      throw new Error(SECRET_ERROR)
    })
    const response = await getHealth({ context: contextWithDb(execute) })
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(JSON.parse(text)).toEqual({
      status: 'degraded',
      checks: { database: 'error' },
    })
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('ECONNREFUSED')
  })
})
