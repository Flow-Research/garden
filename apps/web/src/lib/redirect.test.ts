import { describe, expect, it } from 'vitest'
import { sanitizeRedirectTarget } from './redirect'

describe('sanitizeRedirectTarget', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(sanitizeRedirectTarget('/tasks/abc?view=board#top')).toBe(
      '/tasks/abc?view=board#top',
    )
  })

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'tasks',
    '',
    42,
    undefined,
  ])('falls back for %j', (target) => {
    expect(sanitizeRedirectTarget(target, '/home')).toBe('/home')
  })
})
