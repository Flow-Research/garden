export type GmailProviderContext = {
  readonly connectionName: string
  readonly threadId: string
}

/**
 * Converts Garden's canonical imported-thread key into the minimum provider
 * reference Executor needs. The sync-account UUID remains server-side; a
 * malformed or non-Gmail key produces no provider authority.
 */
export const gmailProviderContext = (input: {
  readonly executorIntegration: string
  readonly executorConnectionName: string
  readonly syncAccountId: string
  readonly threadKey: string
}): GmailProviderContext | null => {
  if (input.executorIntegration !== 'google_gmail') return null
  const prefix = `gmail:${input.syncAccountId}:`
  if (!input.threadKey.startsWith(prefix)) return null

  const threadId = input.threadKey.slice(prefix.length)
  const connectionName = input.executorConnectionName.trim()
  if (
    !connectionName ||
    connectionName.length > 128 ||
    !threadId ||
    threadId.length > 256 ||
    !/^[a-zA-Z0-9_-]+$/.test(threadId)
  ) {
    return null
  }
  return { connectionName, threadId }
}
