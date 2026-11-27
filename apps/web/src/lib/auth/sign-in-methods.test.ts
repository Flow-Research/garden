import { describe, expect, it } from 'vitest'
import { hasPasswordSignInMethod } from './sign-in-methods'

describe('hasPasswordSignInMethod', () => {
  it('accepts a Better Auth credential account', () => {
    expect(
      hasPasswordSignInMethod([
        { providerId: 'google' },
        { providerId: 'credential' },
      ]),
    ).toBe(true)
  })

  it.each(['gmail', 'google-drive', 'slack'])(
    'does not count the %s connector as a sign-in method',
    (providerId) => {
      expect(
        hasPasswordSignInMethod([{ providerId: 'google' }, { providerId }]),
      ).toBe(false)
    },
  )
})
