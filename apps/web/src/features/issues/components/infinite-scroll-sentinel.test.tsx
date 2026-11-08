import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InfiniteScrollSentinel } from './infinite-scroll-sentinel'

/** A fake observer that reports the sentinel as visible when it starts. */
let observing = 0
class VisibleObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() {
    observing += 1
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  disconnect() {
    observing -= 1
  }
}

describe('InfiniteScrollSentinel', () => {
  beforeEach(() => {
    observing = 0
    vi.stubGlobal('IntersectionObserver', VisibleObserver)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads again after a page if it is still on screen', () => {
    const onVisible = vi.fn()
    const { rerender } = render(
      <InfiniteScrollSentinel onVisible={onVisible} loading={false} />,
    )
    expect(onVisible).toHaveBeenCalledTimes(1)

    rerender(<InfiniteScrollSentinel onVisible={onVisible} loading />)
    expect(observing).toBe(0)
    rerender(<InfiniteScrollSentinel onVisible={onVisible} loading={false} />)

    expect(onVisible).toHaveBeenCalledTimes(2)
  })

  it('stops after a failure and offers a retry', () => {
    const onVisible = vi.fn()
    render(
      <InfiniteScrollSentinel onVisible={onVisible} loading={false} failed />,
    )

    expect(onVisible).not.toHaveBeenCalled()
    expect(observing).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onVisible).toHaveBeenCalledTimes(1)
  })
})
