const GOOGLE_ACCOUNT_NOT_LINKED_MESSAGE =
  'Google could not be linked to this account. Sign in with your password, then connect Google in Settings.'

/**
 * Converts OAuth callback codes into safe user-facing copy. Better Auth returns
 * `account_not_linked` is now a rare fallback for a provider that cannot be
 * linked. Lazy linking handles trusted Google accounts with matching emails.
 */
export function oauthErrorMessage(error: unknown) {
  if (typeof error !== 'string') return undefined

  if (error === 'account_not_linked') {
    return GOOGLE_ACCOUNT_NOT_LINKED_MESSAGE
  }

  return 'Google sign-in failed. Try again.'
}
