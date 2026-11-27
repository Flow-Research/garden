import { describe, expect, it } from 'vitest'
import {
  canCommentResumeRun,
  readRunConnectorIdentity,
} from './run-connector-identity'

describe('waiting run connector identity', () => {
  it.each(['triggering_member', 'delegating_member'] as const)(
    'resumes %s only for the saved member',
    (basis) => {
      const snapshot = {
        actor:
          basis === 'triggering_member'
            ? { type: 'member', id: 'member-a' }
            : { type: 'agent', id: 'agent-a' },
        connectorIdentity: { userId: 'member-a', basis },
      }
      expect(
        canCommentResumeRun(snapshot, { type: 'member', id: 'member-a' }),
      ).toBe(true)
      expect(
        canCommentResumeRun(snapshot, { type: 'member', id: 'member-b' }),
      ).toBe(false)
      expect(
        canCommentResumeRun(snapshot, { type: 'agent', id: 'member-a' }),
      ).toBe(false)
    },
  )

  it('keeps an older member run usable without personal connections', () => {
    const snapshot = { actor: { type: 'member', id: 'member-a' } }
    expect(
      canCommentResumeRun(snapshot, { type: 'member', id: 'member-a' }),
    ).toBe(true)
    expect(
      canCommentResumeRun(snapshot, { type: 'member', id: 'member-b' }),
    ).toBe(false)
    expect(readRunConnectorIdentity(snapshot).userId).toBeNull()
  })

  it('fails closed on missing or inconsistent evidence', () => {
    const actor = { type: 'member' as const, id: 'member-a' }
    expect(canCommentResumeRun({}, actor)).toBe(false)
    expect(
      canCommentResumeRun({ actor: { type: 'agent', id: 'agent-a' } }, actor),
    ).toBe(false)
    expect(
      canCommentResumeRun(
        { connectorIdentity: { basis: 'triggering_member', userId: null } },
        actor,
      ),
    ).toBe(false)
    expect(
      canCommentResumeRun(
        { connectorIdentity: { basis: 'no_member', userId: 'member-a' } },
        actor,
      ),
    ).toBe(false)
    expect(
      canCommentResumeRun(
        {
          actor: { type: 'member', id: 'member-b' },
          connectorIdentity: { basis: 'triggering_member', userId: 'member-a' },
        },
        actor,
      ),
    ).toBe(false)
  })
})
