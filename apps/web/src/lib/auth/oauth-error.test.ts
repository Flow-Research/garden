import { describe, expect, it } from 'vitest'
import { oauthErrorMessage } from './oauth-error'

describe('oauthErrorMessage', () => {
  it('explains how to recover when Google cannot be linked', () => {
    expect(oauthErrorMessage('account_not_linked')).toBe(
      'Google could not be linked to this account. Sign in with your password, then connect Google in Settings.',
    )
  })

  it('does not expose unknown OAuth error details', () => {
    expect(oauthErrorMessage('invalid_code')).toBe(
      'Google sign-in failed. Try again.',
    )
    expect(oauthErrorMessage(undefined)).toBeUndefined()
  })
})
