import { describe, expect, it, vi } from 'vitest'
import {
  isMailRuntime,
  markMailContextRecoveryPending,
  mailContextTokenUse,
  mailMessageConcurrency,
} from './mail-context-token'

const future = '2026-08-12T12:15:00.000Z'
const now = '2026-08-12T12:00:00.000Z'

describe('mail context capability lifecycle', () => {
  it('consumes once, then permits only continuation reuse', () => {
    expect(
      mailContextTokenUse(
        {
          consumedAt: null,
          completedAt: null,
          recoveryPending: false,
          expiresAt: future,
        },
        now,
        'initial',
      ),
    ).toEqual({ _tag: 'Consume' })
    expect(
      mailContextTokenUse(
        {
          consumedAt: '2026-08-12T12:00:01.000Z',
          completedAt: null,
          recoveryPending: false,
          expiresAt: future,
        },
        now,
        'initial',
      ),
    ).toEqual({ _tag: 'Reject', reason: 'already-consumed' })
    expect(
      mailContextTokenUse(
        {
          consumedAt: '2026-08-12T12:00:01.000Z',
          completedAt: null,
          recoveryPending: false,
          expiresAt: future,
        },
        now,
        'continuation',
      ),
    ).toEqual({ _tag: 'Continue' })
  })

  it('allows exactly the durable recovery handoff, never a normal replay', () => {
    const consumedAt = '2026-08-12T12:00:01.000Z'
    expect(
      mailContextTokenUse(
        {
          consumedAt,
          completedAt: null,
          recoveryPending: true,
          expiresAt: future,
        },
        now,
        'initial',
      ),
    ).toEqual({ _tag: 'Recover' })
    expect(
      mailContextTokenUse(
        {
          consumedAt,
          completedAt: null,
          recoveryPending: false,
          expiresAt: future,
        },
        now,
        'initial',
      ),
    ).toEqual({ _tag: 'Reject', reason: 'already-consumed' })
    expect(
      mailContextTokenUse(
        {
          consumedAt: null,
          completedAt: null,
          recoveryPending: true,
          expiresAt: future,
        },
        now,
        'initial',
      ),
    ).toEqual({ _tag: 'Reject', reason: 'recovery-not-started' })
  })

  it('keeps repeated recovery hooks bound to one consumed lease', () => {
    const active = {
      consumedAt: '2026-08-12T12:00:01.000Z',
      completedAt: null,
      recoveryPending: false,
      expiresAt: future,
    }
    const firstHook = markMailContextRecoveryPending(active, now)
    const repeatedHook = markMailContextRecoveryPending(firstHook, now)

    expect(repeatedHook).toEqual(firstHook)
    expect(mailContextTokenUse(repeatedHook, now, 'initial')).toEqual({
      _tag: 'Recover',
    })
    const claimed = { ...repeatedHook, recoveryPending: false }
    expect(mailContextTokenUse(claimed, now, 'initial')).toEqual({
      _tag: 'Reject',
      reason: 'already-consumed',
    })
  })

  it('rejects a continuation before initial atomic consumption', () => {
    expect(
      mailContextTokenUse(
        {
          consumedAt: null,
          completedAt: null,
          recoveryPending: false,
          expiresAt: future,
        },
        now,
        'continuation',
      ),
    ).toEqual({ _tag: 'Reject', reason: 'continuation-not-started' })
  })

  it('rejects completed and expired capabilities', () => {
    expect(
      mailContextTokenUse(
        {
          consumedAt: now,
          completedAt: '2026-08-12T12:02:00.000Z',
          recoveryPending: false,
          expiresAt: future,
        },
        now,
        'continuation',
      ),
    ).toEqual({ _tag: 'Reject', reason: 'completed' })
    expect(
      mailContextTokenUse(
        {
          consumedAt: now,
          completedAt: null,
          recoveryPending: true,
          expiresAt: now,
        },
        now,
        'initial',
      ),
    ).toEqual({ _tag: 'Reject', reason: 'expired' })
  })

  it('drops overlap only for hidden Inbox runtimes', () => {
    expect(mailMessageConcurrency(true)).toBe('drop')
    expect(mailMessageConcurrency(false)).toBe('merge')
  })

  it('detects only the durable server-written Inbox marker', () => {
    const storage = {
      sql: {
        exec: vi.fn(() => [{ singleton: 1 }]),
      },
    } as unknown as DurableObjectStorage

    expect(isMailRuntime(storage)).toBe(true)
    expect(storage.sql.exec).toHaveBeenCalledWith(
      'select singleton from mail_runtime_config where singleton = 1',
    )
  })
})
