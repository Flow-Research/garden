import { describe, expect, it } from 'vitest'
import { readMarkdownFileText } from './skill-from-markdown'

describe('readMarkdownFileText', () => {
  it('returns markdown file text', async () => {
    const file = new File(['# Hello\n\nBody'], 'README.md', {
      type: 'text/markdown',
    })
    const result = await readMarkdownFileText(file)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toBe('# Hello\n\nBody')
  })

  it('rejects non-markdown and empty files', async () => {
    const txt = await readMarkdownFileText(
      new File(['nope'], 'notes.txt', { type: 'text/plain' }),
    )
    expect(txt.isErr()).toBe(true)

    const empty = await readMarkdownFileText(
      new File(['   \n'], 'README.md', { type: 'text/markdown' }),
    )
    expect(empty.isErr()).toBe(true)
  })
})
