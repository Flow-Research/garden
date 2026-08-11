/**
 * A Gmail connection is an external, read-only import source. It must never be
 * offered by Garden's composer as a sending mailbox.
 */
export type GmailImportAccountView = {
  connectionAddress: string
  identityLabel: string
  iconUrl: string | null
  importMode: 'read_only'
}

export type GmailImportState =
  | { status: 'unavailable' }
  | { status: 'checking' }
  | { status: 'disconnected' }
  | { status: 'authorizing' }
  | { status: 'connected' }
  | { status: 'scanning' }
  | { status: 'syncing'; processed: number; total: number }
  | {
      status: 'complete'
      imported: number
      skipped: number
      finishedAtLabel: string
    }
  | {
      status: 'failed'
      processed: number
      total: number | null
      message: string
    }

export type GmailImportController = {
  state: GmailImportState
  accounts: readonly GmailImportAccountView[]
  selectedConnectionAddress: string | null
  gmailIconUrl: string | null
  actions: {
    connect: () => void
    selectAccount: (connectionAddress: string) => void
    startImport: () => void
    retryImport: () => void
  }
}

const unavailableAction = () => undefined

/** Keeps Gmail UI absent until an authenticated connection adapter is wired. */
export const unavailableGmailImportController: GmailImportController = {
  state: { status: 'unavailable' },
  accounts: [],
  selectedConnectionAddress: null,
  gmailIconUrl: null,
  actions: {
    connect: unavailableAction,
    selectAccount: unavailableAction,
    startImport: unavailableAction,
    retryImport: unavailableAction,
  },
}

/** Resolves the explicit account selection without guessing from user identity. */
export function selectedGmailImportAccount(
  controller: GmailImportController,
): GmailImportAccountView | null {
  const selected = controller.selectedConnectionAddress
  if (selected !== null) {
    const account = controller.accounts.find(
      (candidate) => candidate.connectionAddress === selected,
    )
    if (account) return account
  }
  return controller.accounts.length === 1 ? controller.accounts[0] : null
}
