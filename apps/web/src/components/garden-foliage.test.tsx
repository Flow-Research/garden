import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GardenBackdrop } from './garden-foliage'

describe('GardenBackdrop', () => {
  it('stays decorative: hidden from assistive tech, out of hit testing, behind content', () => {
    render(<GardenBackdrop />)
    const backdrop = screen.getByTestId('garden-backdrop')

    expect(backdrop.getAttribute('aria-hidden')).toBe('true')
    expect(backdrop.className).toContain('pointer-events-none')
    expect(backdrop.className).toContain('fixed')
    expect(backdrop.className).toContain('-z-10')
  })

  it('draws the foliage bed with the growth classes the reduced-motion guard targets', () => {
    const { container } = render(<GardenBackdrop />)

    expect(container.querySelectorAll('.foliage-stem').length).toBeGreaterThan(
      0,
    )
    expect(container.querySelectorAll('.foliage-leaf').length).toBeGreaterThan(
      0,
    )
    expect(container.querySelectorAll('.foliage-bloom').length).toBeGreaterThan(
      0,
    )
  })
})
