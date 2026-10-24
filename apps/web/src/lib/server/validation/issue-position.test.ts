import { describe, expect, it } from 'vitest'
import { updateIssueBodySchema } from './issues'

describe('issue position validation', () => {
  it('accepts an order key, including one between adjacent keys', () => {
    expect(updateIssueBodySchema.safeParse({ position: 'a0' }).success).toBe(
      true,
    )
    expect(updateIssueBodySchema.safeParse({ position: 'a0V' }).success).toBe(
      true,
    )
  })

  it('rejects numbers and malformed keys', () => {
    expect(updateIssueBodySchema.safeParse({ position: 3 }).success).toBe(false)
    expect(updateIssueBodySchema.safeParse({ position: '3.5' }).success).toBe(
      false,
    )
    expect(updateIssueBodySchema.safeParse({ position: 'a00' }).success).toBe(
      false,
    )
  })
})
