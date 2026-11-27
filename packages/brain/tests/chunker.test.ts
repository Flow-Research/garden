import { describe, expect, it } from '@effect/vitest'
import {
  chunkBySize,
  chunkForFormat,
  splitHeadings,
} from '../src/services/Chunker.ts'

describe('splitHeadings', () => {
  it('splits markdown bodies on headings', () => {
    const chunks = splitHeadings(
      '## Nodes and edges\nA node carries labels.\n\n## Query model\nQueries are JSON.',
    )
    expect(chunks.map((chunk) => chunk.title)).toEqual([
      'Nodes and edges',
      'Query model',
    ])
    expect(chunks[0]?.body).toContain('labels')
    expect(chunks[1]?.body).toContain('JSON')
  })

  it('prefixes each section body with its heading chain', () => {
    const chunks = splitHeadings(
      '# Doc\n## A\nfirst\n### A1\nnested\n## B\nsecond',
    )
    expect(chunks.map((chunk) => chunk.title)).toEqual(['Doc', 'A', 'A1', 'B'])
    expect(chunks.map((chunk) => chunk.path)).toEqual([
      'Doc',
      'Doc > A',
      'Doc > A > A1',
      'Doc > B',
    ])
    expect(chunks[1]?.body).toBe('Doc > A\n\nfirst')
    expect(chunks[2]?.body).toContain('Doc > A > A1')
    expect(chunks[3]?.body).toContain('Doc > B')
  })

  it('uses the root title as the chain root when provided', () => {
    const chunks = chunkForFormat(
      'markdown',
      '## Nodes and edges\nbody',
      undefined,
      'HelixDB Basics',
    )
    expect(chunks[0]?.path).toBe('HelixDB Basics > Nodes and edges')
    expect(chunks[0]?.body).toContain('HelixDB Basics > Nodes and edges')
  })

  it('carries the chain across oversize sections with unique paths', () => {
    const longBody = 'alpha beta gamma delta epsilon zeta eta theta '.repeat(30)
    const chunks = splitHeadings(`# Doc\n## Big\n${longBody}`, {
      size: 100,
      overlap: 20,
    })
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks[1]?.title).toBe('Big')
    expect(chunks[1]?.path).toBe('Doc > Big')
    expect(chunks[2]?.path).toBe('Doc > Big (2)')
    expect(
      chunks.slice(1).every((chunk) => chunk.body.startsWith('Doc > Big')),
    ).toBe(true)
    expect(new Set(chunks.map((chunk) => chunk.path)).size).toBe(chunks.length)
  })

  it('keeps an empty section as a breadcrumb-only body', () => {
    const chunks = splitHeadings('# Doc\n## Empty\n## Next\ncontent')
    expect(chunks[1]?.title).toBe('Empty')
    expect(chunks[1]?.body).toBe('Doc > Empty')
    expect(chunks[2]?.body).toBe('Doc > Next\n\ncontent')
  })

  it('keeps text before the first heading as a preamble chunk', () => {
    const chunks = splitHeadings(
      'Context that applies to every section.\n\n## Details\nsection body',
    )
    expect(chunks.map((chunk) => chunk.title)).toEqual(['Preamble', 'Details'])
    expect(chunks[0]?.body).toContain('Context that applies to every section.')
    expect(chunks[1]?.body).toContain('section body')
  })

  it('returns no heading sections for heading-free text', () => {
    expect(splitHeadings('Plain text without a heading.')).toEqual([])
  })
})

describe('chunkBySize', () => {
  it('returns a single chunk when the body fits', () => {
    const chunks = chunkBySize('short body', { size: 1000, overlap: 100 })
    expect(chunks.length).toBe(1)
    expect(chunks[0]?.body).toBe('short body')
  })

  it('splits long bodies into multiple chunks with overlap', () => {
    const paragraph = 'alpha beta gamma delta epsilon zeta eta theta '.repeat(
      20,
    )
    const chunks = chunkBySize(paragraph, { size: 100, overlap: 20 })
    expect(chunks.length).toBeGreaterThan(1)
    const joined = chunks.map((chunk) => chunk.body).join(' ')
    expect(joined).toContain('alpha')
    expect(joined).toContain('eta')
    expect(chunks.every((chunk) => chunk.body.length > 0)).toBe(true)
  })

  it('numbers chunks sequentially', () => {
    const paragraph = 'alpha beta gamma delta epsilon zeta eta theta '.repeat(
      20,
    )
    const chunks = chunkBySize(paragraph, { size: 100, overlap: 20 })
    expect(chunks.map((chunk) => chunk.title)).toEqual(
      chunks.map((_, i) => `Part ${i + 1}`),
    )
  })

  it('keeps the remainder of an oversized paragraph', () => {
    const terminalMarker = 'terminal-content-marker'
    const chunks = chunkBySize(
      `${'oversized paragraph content '.repeat(20)}${terminalMarker}`,
      { size: 80, overlap: 12 },
    )
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.some((chunk) => chunk.body.includes(terminalMarker))).toBe(
      true,
    )
  })

  it('bounds overlap for one long unbroken token', () => {
    const chunks = chunkBySize('x'.repeat(250), {
      size: 100,
      overlap: 10,
    })

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) => chunk.body.length <= 100)).toBe(true)
  })

  it('preserves one long unbroken token when overlap is disabled', () => {
    const body = 'x'.repeat(250)
    const chunks = chunkBySize(body, { size: 100, overlap: 0 })

    expect(chunks.map((chunk) => chunk.body).join('')).toBe(body)
  })
})

describe('chunkForFormat', () => {
  it('uses heading structure for markdown, docx and xlsx', () => {
    const markdown = chunkForFormat('markdown', '## Heading\nbody')
    expect(markdown.map((chunk) => chunk.title)).toEqual(['Heading'])
    const docx = chunkForFormat(
      'docx',
      '# Garden\n## Compost bins\nbrown matter\n## Soil\nsandy',
    )
    expect(docx.map((chunk) => chunk.title)).toEqual([
      'Garden',
      'Compost bins',
      'Soil',
    ])
    expect(docx[1]?.path).toBe('Garden > Compost bins')
    const xlsx = chunkForFormat('xlsx', '## Sheet A\nrow1\n\n## Sheet B\nrow2')
    expect(xlsx.map((chunk) => chunk.title)).toEqual(['Sheet A', 'Sheet B'])
  })

  it('uses size chunking for text and pdf', () => {
    const txt = chunkForFormat('text', 'a b c '.repeat(50), {
      size: 50,
      overlap: 10,
    })
    expect(txt.length).toBeGreaterThan(1)
    expect(txt[0]?.title).toBe('Part 1')
  })

  it('honors size options for structured text without headings', () => {
    const chunks = chunkForFormat(
      'markdown',
      'heading-free structured content '.repeat(20),
      { size: 60, overlap: 10 },
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.body.length <= 60)).toBe(true)
    expect(chunks[0]?.title).toBe('Part 1')
  })
})
