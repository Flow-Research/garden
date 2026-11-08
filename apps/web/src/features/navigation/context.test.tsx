import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NavigationProvider, useNavigationActions } from './context'
import type { NavigationActions, NavigationAdapter } from './types'

describe('useNavigationActions', () => {
  it('keeps its identity when only the URL changes', () => {
    const push = vi.fn()
    const replace = vi.fn()
    const back = vi.fn()
    const seen: NavigationActions[] = []
    function Probe() {
      seen.push(useNavigationActions())
      return null
    }
    const adapter = (pathname: string): NavigationAdapter => ({
      push,
      replace,
      back,
      pathname,
      searchParams: new URLSearchParams(),
    })

    const { rerender } = render(
      <NavigationProvider value={adapter('/a')}>
        <Probe />
      </NavigationProvider>,
    )
    rerender(
      <NavigationProvider value={adapter('/b')}>
        <Probe />
      </NavigationProvider>,
    )

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.at(-1)).toBe(seen[0])
    seen[0]!.push('/x')
    expect(push).toHaveBeenCalledWith('/x')
  })
})
