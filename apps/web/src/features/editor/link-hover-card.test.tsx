import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLinkHover } from './link-hover-card'

let selectionActive = false

function Harness() {
  const hover = useLinkHover(() => selectionActive)
  return (
    <div ref={hover.containerRef}>
      <a href="https://example.com">Example</a>
      <output>{hover.preview ? 'card open' : 'card closed'}</output>
    </div>
  )
}

describe('useLinkHover', () => {
  afterEach(() => vi.useRealTimers())

  it('checks for a selection when the pointer reaches the link', () => {
    vi.useFakeTimers()
    render(<Harness />)
    const link = screen.getByText('Example')

    // The selection appears after render, with no re-render in between.
    selectionActive = true
    fireEvent.mouseOver(link)
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByText('card closed')).toBeInTheDocument()

    selectionActive = false
    fireEvent.mouseOver(link)
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByText('card open')).toBeInTheDocument()
  })
})
