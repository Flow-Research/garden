import { describe, expect, it } from 'vitest'
import { resolveMailSettingsView } from './mail-settings-view'

describe('resolveMailSettingsView', () => {
  it('shows setup when the ready controller has no domains', () => {
    expect(resolveMailSettingsView({ domains: [] })).toBe('setup')
  })

  it('shows administration when the ready controller has a domain', () => {
    expect(
      resolveMailSettingsView({
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
})
