type AuthAccount = {
  providerId: string
}

/**
 * Returns whether a password remains after Google is unlinked. Better Auth
 * stores password accounts with provider ID `credential`, while Garden stores
 * Gmail, Drive, and Slack connector accounts in the same table. Connector
 * accounts cannot sign in through Garden's auth screen and must not satisfy
 * the last-sign-in-method check. Reference: Better Auth 1.6.26 password and
 * unlink-account route source.
 */
export function hasPasswordSignInMethod(accounts: ReadonlyArray<AuthAccount>) {
  return accounts.some((account) => account.providerId === 'credential')
}
