import { describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import { createAppVersionStore, resolveVersionCheck } from './app-version'

describe('app version checks', () => {
  it('only advertises a different valid deployment', () => {
    expect(resolveVersionCheck('release-a', null)).toEqual({
      kind: 'unavailable',
    })
    expect(resolveVersionCheck('release-a', { version: 'release-a' })).toEqual({
      kind: 'current',
    })
    expect(resolveVersionCheck('release-a', { version: 'release-b' })).toEqual({
      kind: 'update-available',
      version: 'release-b',
    })
  })

  it('notifies subscribers when a new deployment appears', async () => {
    const listener = vi.fn()
    const store = createAppVersionStore('release-a', () =>
      Promise.resolve(
        Result.ok({
          kind: 'update-available' as const,
          version: 'release-b',
        }),
      ),
    )

    const unsubscribe = store.subscribe(listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())

    expect(store.getSnapshot()).toEqual({
      kind: 'update-available',
      version: 'release-b',
    })
    unsubscribe()
  })
})
