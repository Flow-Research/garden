import { describe, expect, it } from 'vitest'
import { htmlToDocumentBlocks } from './document-artifact-projection'

describe('htmlToDocumentBlocks', () => {
  it('keeps semantic top-level blocks and removes active content', () => {
    const blocks = htmlToDocumentBlocks(
      '<h1 onclick="steal()">Plan</h1><script>steal()</script><p><a href="javascript:steal()">unsafe</a> body</p>',
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.html).toBe('<h1>Plan</h1>')
    expect(blocks[1]?.html).toBe('<p><a>unsafe</a> body</p>')
  })

  it('wraps top-level inline content in a paragraph block', () => {
    const blocks = htmlToDocumentBlocks('plain <strong>text</strong>')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.html).toBe('<p>plain <strong>text</strong></p>')
  })
})
