import { describe, expect, it } from 'vitest'
import {
  importMarkdownIntoEmptySheet,
  readMarkdownFileText,
} from './skill-from-markdown'

function markdownFile(contents: string, name = 'README.md') {
  return new File([contents], name, { type: 'text/markdown' })
}

/** File whose `text()` stays pending until `release` is called. */
function gatedMarkdownFile(contents: string) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const file = markdownFile(contents)
  Object.defineProperty(file, 'text', {
    value: () => gate.then(() => contents),
  })
  return { file, release }
}

describe('readMarkdownFileText', () => {
  it('returns markdown file text', async () => {
    const result = await readMarkdownFileText(markdownFile('# Hello\n\nBody'))
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toBe('# Hello\n\nBody')
  })

  it('rejects non-markdown and empty files', async () => {
    const txt = await readMarkdownFileText(
      new File(['nope'], 'notes.txt', { type: 'text/plain' }),
    )
    expect(txt.isErr()).toBe(true)

    const empty = await readMarkdownFileText(markdownFile('   \n'))
    expect(empty.isErr()).toBe(true)
  })
})

describe('importMarkdownIntoEmptySheet', () => {
  it('imports when the sheet stays empty through the read', async () => {
    const result = await importMarkdownIntoEmptySheet(
      markdownFile('# imported\n'),
      () => '',
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toBe('# imported\n')
  })

  it('refuses import if the sheet fills during the file read', async () => {
    const { file, release } = gatedMarkdownFile('# imported\n')
    let sheet = ''
    const pending = importMarkdownIntoEmptySheet(file, () => sheet)
    sheet = 'typed while the file was reading'
    release()
    const result = await pending
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.message).toBe('Editor already has content')
  })
})
