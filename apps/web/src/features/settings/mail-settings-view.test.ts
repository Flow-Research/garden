import { describe, expect, it } from 'vitest'
import { resolveMailSettingsView } from './mail-settings-view'

describe('resolveMailSettingsView', () => {
  it('shows setup when the ready controller has no domains', () => {
    expect(resolveMailSettingsView({ domains: [], mailboxes: [] })).toBe(
      'setup',
    )
  })

  it('shows administration when the ready controller has a domain', () => {
    expect(
      resolveMailSettingsView({
        mailboxes: [],
        domains: [
          {
            id: 'domain-1',
            name: 'example.com',
            status: 'active',
            sendingEnabled: true,
            routingEnabled: true,
            catchAllEnabled: true,
          },
        ],
      }),
    ).toBe('admin')
  })

  it('shows administration for an imported mailbox without a hosted domain', () => {
    expect(
      resolveMailSettingsView({
        domains: [],
        mailboxes: [
          {
            id: 'gmail-mailbox',
            domainId: null,
            name: 'person@example.com',
            kind: 'personal',
            origin: 'external_import',
            status: 'active',
            primaryAddress: 'person@example.com',
            addresses: [],
            access: [],
          },
        ],
      }),
    ).toBe('admin')
  })
})
