import { describe, expect, it } from 'vitest'
import { createSecureReadCache } from './secure-cache'

function fixture() {
  const values = new Map<string, string>()
  let writes = 0
  let failAt = Infinity
  const cache = createSecureReadCache({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      writes += 1
      if (writes === failAt) throw new Error('Device storage unavailable')
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1536)
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    },
  })
  return {
    cache,
    values,
    failAt: (value: number) => {
      failAt = value
    },
  }
}

describe('encrypted read cache publication', () => {
  it('round-trips Unicode in bounded chunks and removes every stored chunk', async () => {
    const app = fixture()
    const text = '🌱 private '.repeat(1000)
    await app.cache.write(text)
    expect(await app.cache.read()).toBe(text)
    expect(app.values.size).toBeGreaterThan(2)
    await app.cache.clear()
    expect(app.values.size).toBe(0)
    expect(await app.cache.read()).toBeNull()
  })

  it('does not publish a partial replacement after an interrupted write', async () => {
    const app = fixture()
    await app.cache.write('old private reads')
    app.failAt(4)
    await expect(app.cache.write('new'.repeat(1000))).rejects.toThrow(
      'Device storage unavailable',
    )
    expect(await app.cache.read()).toBeNull()
    await app.cache.clear()
    expect(app.values.size).toBe(0)
  })

  it('rejects an excessive snapshot before replacing an existing valid one', async () => {
    const app = fixture()
    await app.cache.write('bounded')
    await expect(app.cache.write('x'.repeat(24_577))).rejects.toThrow(
      'device limit',
    )
    expect(await app.cache.read()).toBe('bounded')
  })

  it('refuses corrupt manifests and missing chunks without exposing partial reads', async () => {
    const app = fixture()
    app.values.set('garden.mobile.reads.v1', '999999')
    expect(await app.cache.read()).toBeNull()
    app.values.set('garden.mobile.reads.v1', '2')
    app.values.set('garden.mobile.reads.v1.0', 'partial')
    expect(await app.cache.read()).toBeNull()
  })
})
