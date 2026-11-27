import { describe, expect, it } from 'vitest'
import {
  csvFileNameCell,
  formatFileSize,
  formatUploadedDate,
  formatUploadedTime,
  truncateMiddle,
} from './format'

describe('formatUploadedDate', () => {
  it('renders the designed comma format', () => {
    expect(formatUploadedDate(undefined)).toBe('—')
    expect(formatUploadedDate('2024-07-07T13:42:00.000Z')).toMatch(
      /^\d{2} [A-Za-z]+, \d{4}$/,
    )
  })
})

describe('formatUploadedTime', () => {
  it('renders the designed 12-hour AM/PM format', () => {
    expect(formatUploadedTime(undefined)).toBe('—')
    // Local-time constructor keeps the expectation timezone-independent.
    expect(formatUploadedTime(new Date(2024, 6, 7, 14, 23).toISOString())).toBe(
      '02:23 PM',
    )
    expect(formatUploadedTime(new Date(2024, 6, 7, 2, 23).toISOString())).toBe(
      '02:23 AM',
    )
  })
})

describe('truncateMiddle', () => {
  it('returns short names unchanged', () => {
    expect(truncateMiddle('notes.txt')).toBe('notes.txt')
  })

  it('middle-ellipsizes long names, keeping the extension visible', () => {
    const long = `${'quarterly-'.repeat(8)}final.pdf`
    const result = truncateMiddle(long, 40)

    expect(result.length).toBe(40)
    expect(result).toContain('…')
    expect(result.endsWith('final.pdf')).toBe(true)
  })

  it('respects custom limits', () => {
    expect(truncateMiddle('abcdefghij.txt', 10)).toBe('abcde….txt')
  })
})

describe('formatFileSize', () => {
  it('formats bytes, KB, and MB', () => {
    expect(formatFileSize(undefined)).toBe('—')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(11_264)).toBe('11 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(5_242_880)).toBe('5 MB')
  })
})

describe('csvFileNameCell', () => {
  it('quote-escapes and wraps names', () => {
    expect(csvFileNameCell('plain.txt')).toBe('"plain.txt"')
    expect(csvFileNameCell('with "quote".txt')).toBe('"with ""quote"".txt"')
  })

  it('neutralizes formula-leading names (CSV injection)', () => {
    expect(csvFileNameCell('=SUM(A1:A9)')).toBe(`"'=SUM(A1:A9)"`)
    expect(csvFileNameCell('+cmd.txt')).toBe(`"'+cmd.txt"`)
    expect(csvFileNameCell('-10.txt')).toBe(`"'-10.txt"`)
    expect(csvFileNameCell('@mention.csv')).toBe(`"'@mention.csv"`)
  })
})
