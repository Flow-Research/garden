import { describe, expect, it } from 'vitest'
import { deriveIssuePrefix, formatIssueIdentifier } from './identifier'

describe('deriveIssuePrefix', () => {
  it('uppercases and clamps alphabetic names', () => {
    expect(deriveIssuePrefix('Accounting')).toBe('ACC')
  })

  it('pads short names to the minimum length', () => {
    expect(deriveIssuePrefix('A')).toBe('AX')
  })

  it('falls back for empty names after stripping', () => {
    expect(deriveIssuePrefix(' -- ')).toBe('ISS')
  })

  it('keeps digits', () => {
    expect(deriveIssuePrefix('42 Labs')).toBe('42L')
  })

  it('handles mixed punctuation and casing', () => {
    expect(deriveIssuePrefix('r&d ops')).toBe('RDO')
  })
})

describe('formatIssueIdentifier', () => {
  it('formats a basic issue number', () => {
    expect(formatIssueIdentifier('RDO', 12)).toBe('RDO-12')
  })

  it('formats zero', () => {
    expect(formatIssueIdentifier('RDO', 0)).toBe('RDO-0')
  })

  it('formats a large number', () => {
    expect(formatIssueIdentifier('RDO', 123456)).toBe('RDO-123456')
  })
})
