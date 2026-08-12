import { describe, expect, it } from 'vitest'
import { MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES } from './mail-tool-scope'

describe('mail tool scope', () => {
  it('hard-denies disconnected provider accounts', () => {
    expect(MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES).not.toContain('disconnected')
  })
})
