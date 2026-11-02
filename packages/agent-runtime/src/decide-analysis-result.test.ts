import { describe, expect, it } from 'vitest'
import {
  decideGeneratedFiles,
  decideSessionIdFromResult,
} from './decide-analysis-result'

const OUTPUTS =
  'https://api.trydecide.co/uploads/agent-sessions/sess_1793601302761_f0ff875523ec/outputs'

/** Shape of a real staging `result_json`: text blocks, no structuredContent. */
const decideResult = (...texts: string[]) => ({
  content: texts.map((text) => ({ type: 'text', text })),
})

describe('decideSessionIdFromResult', () => {
  it('reads the session Decide prints in its text', () => {
    expect(
      decideSessionIdFromResult(
        decideResult(
          'Starting analysis.',
          'Session ID: sess_1793601302761_f0ff875523ec\nRevenue grew 12%.',
        ),
      ),
    ).toBe('sess_1793601302761_f0ff875523ec')
  })

  it('reads the parenthesised form', () => {
    expect(
      decideSessionIdFromResult(
        decideResult('Done (session_id: sess_17936_abc123).'),
      ),
    ).toBe('sess_17936_abc123')
  })

  it('falls back to the session in an output URL', () => {
    expect(
      decideSessionIdFromResult(decideResult(`Download: ${OUTPUTS}/a.xlsx`)),
    ).toBe('sess_1793601302761_f0ff875523ec')
  })

  it('returns null when Decide printed no session', () => {
    expect(decideSessionIdFromResult(decideResult('No session.'))).toBeNull()
    expect(decideSessionIdFromResult(null)).toBeNull()
  })
})

describe('decideGeneratedFiles', () => {
  it('extracts linked output files from the text', () => {
    const files = decideGeneratedFiles(
      decideResult(
        `Your workbook: ${OUTPUTS}/revenue_by_region.xlsx.`,
        `Chart: [growth](${OUTPUTS}/growth%20chart.png) and again ${OUTPUTS}/revenue_by_region.xlsx`,
        'See https://trydecide.co for pricing.',
      ),
    )

    expect(files).toEqual([
      {
        name: 'revenue_by_region.xlsx',
        url: `${OUTPUTS}/revenue_by_region.xlsx`,
      },
      { name: 'growth chart.png', url: `${OUTPUTS}/growth%20chart.png` },
    ])
  })

  it('keeps MCP resource links', () => {
    expect(
      decideGeneratedFiles({
        content: [
          {
            type: 'resource_link',
            name: 'report.pdf',
            uri: `${OUTPUTS}/r.pdf`,
          },
        ],
      }),
    ).toEqual([{ name: 'report.pdf', url: `${OUTPUTS}/r.pdf` }])
  })
})
