import { describe, expect, it } from 'vitest'
import { cn } from '@garden/ui/lib/utils'

describe('cn with the design token scales', () => {
  it('lets a token shadow override a default one', () => {
    expect(cn('shadow-md', 'shadow-5')).toBe('shadow-5')
    expect(cn('shadow-1', 'shadow-lg')).toBe('shadow-lg')
  })

  it('lets rounded-pill override another radius', () => {
    expect(cn('rounded-xl', 'rounded-pill')).toBe('rounded-pill')
  })

  it('lets tracking-tightest override another tracking', () => {
    expect(cn('tracking-tight', 'tracking-tightest')).toBe('tracking-tightest')
  })

  it('keeps a font size and a semantic text colour together', () => {
    expect(cn('text-sm', 'text-text-secondary')).toBe(
      'text-sm text-text-secondary',
    )
  })
})
