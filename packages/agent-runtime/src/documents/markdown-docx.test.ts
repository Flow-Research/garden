import mammoth from 'mammoth'
import { describe, expect, it } from 'vitest'
import { markdownToDocx } from './markdown-docx'

const guide = `# Workstream task guide

Intro with **bold** text.

## Steps

- Open the issue
- Write the draft

1. First
2. Second

| Field | Meaning |
| --- | --- |
| Owner | Who does it |
| Due | When it ships |
`

describe('markdownToDocx', () => {
  it('keeps headings, lists and a table when Word reads the file back', async () => {
    const bytes = await markdownToDocx({ title: 'Guide', markdown: guide })
    // mammoth unzips word/document.xml and maps Word styles back to HTML,
    // so this is what a Word reader sees, not what we meant to write.
    const { value: html } = await mammoth.convertToHtml({
      buffer: Buffer.from(bytes),
    })

    expect(html).toContain('<h1>Workstream task guide</h1>')
    expect(html).toContain('<h2>Steps</h2>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toMatch(
      /<ul><li>Open the issue<\/li><li>Write the draft<\/li><\/ul>/,
    )
    expect(html).toMatch(/<ol><li>First<\/li><li>Second<\/li><\/ol>/)
    expect(html).toContain('<table>')
    expect(html).toMatch(/<td><p>Owner<\/p><\/td><td><p>Who does it<\/p><\/td>/)
    expect(html).toContain('<p><strong>Field</strong></p>')
  })
})
