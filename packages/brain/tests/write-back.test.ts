import { describe, expect, it } from 'vitest'
import {
  decideWriteBack,
  type WriteCandidate,
} from '../src/services/write-back.ts'

const candidate = (
  overrides: Partial<WriteCandidate> = {},
): WriteCandidate => ({
  claimHash: 'hash-1',
  claim: 'We chose D1 over Postgres for cost.',
  kind: 'decision',
  confidence: 0.9,
  sensitive: false,
  scope: 'org',
  ...overrides,
})

describe('decideWriteBack', () => {
  it('writes a confident, non-sensitive claim', () => {
    const [decision] = decideWriteBack([candidate()], {
      directWriteConfidence: 0.75,
    })
    expect(decision?.action).toBe('write')
  })

  it('links a claim that already matches an existing item', () => {
    const [decision] = decideWriteBack([candidate({ duplicateOf: 'item-9' })], {
      directWriteConfidence: 0.75,
    })
    expect(decision).toMatchObject({
      action: 'link',
      existingItemId: 'item-9',
    })
  })

  it('sends sensitive claims to review even when confident', () => {
    const [decision] = decideWriteBack([candidate({ sensitive: true })], {
      directWriteConfidence: 0.75,
    })
    expect(decision).toMatchObject({ action: 'review', reason: 'sensitive' })
  })

  it('sends low-confidence claims to review', () => {
    const [decision] = decideWriteBack([candidate({ confidence: 0.4 })], {
      directWriteConfidence: 0.75,
    })
    expect(decision).toMatchObject({
      action: 'review',
      reason: 'low_confidence',
    })
  })

  it('skips blank claims and out-of-range confidence', () => {
    const decisions = decideWriteBack(
      [
        candidate({ claim: '   ' }),
        candidate({ claimHash: 'hash-2', confidence: 1.5 }),
      ],
      { directWriteConfidence: 0.75 },
    )
    expect(decisions[0]).toMatchObject({
      action: 'skip',
      reason: 'blank_claim',
    })
    expect(decisions[1]).toMatchObject({
      action: 'skip',
      reason: 'invalid_confidence',
    })
  })

  it('skips NaN confidence and ignores a blank duplicate id', () => {
    const decisions = decideWriteBack(
      [
        candidate({ confidence: Number.NaN }),
        candidate({ claimHash: 'hash-2', duplicateOf: '   ' }),
      ],
      { directWriteConfidence: 0.75 },
    )
    expect(decisions[0]).toMatchObject({
      action: 'skip',
      reason: 'invalid_confidence',
    })
    expect(decisions[1]?.action).toBe('write')
  })

  it('routes user scope to review even when confident', () => {
    const [decision] = decideWriteBack(
      [candidate({ scope: 'user', confidence: 1 })],
      { directWriteConfidence: 0.75 },
    )
    expect(decision).toMatchObject({ action: 'review', reason: 'user_scope' })
  })

  it('routes user scope to review when low confidence', () => {
    const [decision] = decideWriteBack(
      [candidate({ scope: 'user', confidence: 0.1 })],
      { directWriteConfidence: 0.75 },
    )
    expect(decision).toMatchObject({ action: 'review', reason: 'user_scope' })
  })

  it('skips an invalid scope value', () => {
    const [decision] = decideWriteBack(
      [candidate({ scope: 'team' as unknown as 'org' })],
      { directWriteConfidence: 0.75 },
    )
    expect(decision).toMatchObject({ action: 'skip', reason: 'invalid_scope' })
  })
})
