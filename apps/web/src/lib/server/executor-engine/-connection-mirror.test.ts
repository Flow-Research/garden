import { describe, expect, it } from 'vitest'
import { mirrorRowValues } from './connection-mirror'

describe('mirrorRowValues', () => {
  it('builds an isolated mirror row for a mapped connector', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    expect(
      mirrorRowValues(
        {
          executorSlug: 'google_gmail',
          connectionName: 'gmail',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          identityLabel: 'david@klawva.xyz',
          scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          expiresAtMs: 1789001455000,
        },
        'gmail',
        now,
      ),
    ).toEqual({
      userId: 'user-1',
      accountId: 'david@klawva.xyz',
      providerId: 'executor:google_gmail:gmail',
      workspaceId: 'workspace-1',
      status: 'connected',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      accessTokenExpiresAt: new Date(1789001455000),
      connectorType: 'gmail',
      createdAt: now,
      updatedAt: now,
    })
  })

  it('keys the row per connection name', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    const first = mirrorRowValues(
      {
        executorSlug: 'google_gmail',
        connectionName: 'gmail',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      'gmail',
      now,
    )
    const second = mirrorRowValues(
      {
        executorSlug: 'google_gmail',
        connectionName: 'work',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      'gmail',
      now,
    )
    expect(first.providerId).not.toBe(second.providerId)
  })

  it('falls back to the slug and empty scopes', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    const row = mirrorRowValues(
      {
        executorSlug: 'google_drive',
        connectionName: 'drive',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      'google-drive',
      now,
    )
    expect(row.accountId).toBe('google_drive')
    expect(row.scopes).toEqual([])
    expect(row.accessTokenExpiresAt).toBeNull()
  })
})
