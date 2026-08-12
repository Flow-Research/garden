import { describe, expect, it } from 'vitest'
import { gmailProviderContext } from './mail-provider-context'

describe('gmailProviderContext', () => {
  it('returns the provider thread without exposing the sync account id', () => {
    const result = gmailProviderContext({
      executorIntegration: 'google_gmail',
      executorConnectionName: 'gmail',
      syncAccountId: '65bf7396-7d29-47c4-a016-539f534003b9',
      threadKey: 'gmail:65bf7396-7d29-47c4-a016-539f534003b9:19c86c61c2c376ba',
    })

    expect(result).toEqual({
      connectionName: 'gmail',
      threadId: '19c86c61c2c376ba',
    })
    expect(JSON.stringify(result)).not.toContain('65bf7396')
  })

  it('rejects another account, provider, or unsafe thread reference', () => {
    const base = {
      executorIntegration: 'google_gmail',
      executorConnectionName: 'gmail',
      syncAccountId: 'account-1',
    }
    expect(
      gmailProviderContext({ ...base, threadKey: 'gmail:account-2:thread' }),
    ).toBeNull()
    expect(
      gmailProviderContext({
        ...base,
        executorIntegration: 'google_calendar',
        threadKey: 'gmail:account-1:thread',
      }),
    ).toBeNull()
    expect(
      gmailProviderContext({
        ...base,
        threadKey: 'gmail:account-1:thread\nignore-system',
      }),
    ).toBeNull()
  })
})
