import { describe, expect, it } from 'vitest'
import {
  htmlToDocumentBlocks,
  sanitizeDocumentBlockHtml,
} from './document-artifact-projection'

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

  it('keeps inert editor formatting styles and removes active CSS', () => {
    const sanitized = sanitizeDocumentBlockHtml(
      '<p style="text-align: center; background-image: url(javascript:steal())"><span style="font-family: Georgia, serif; font-size: 18px; color: #123456; behavior: url(x)">Styled</span></p>',
    )
    expect(sanitized).toBe(
      '<p style="text-align: center"><span style="font-family: Georgia, serif; font-size: 18px; color: #123456">Styled</span></p>',
    )
  })

  it('round-trips the bounded command, title, link, and image vocabulary', () => {
    const sanitized = sanitizeDocumentBlockHtml(`
      <h1 class="doc-title"><b>Title</b></h1>
      <p style="text-align: justify; margin-left: 40px">
        <span style="font-family: 'Courier New', monospace; font-size: 48px; background-color: #fff3a3; color: rgb(1, 2, 3); font-weight: bold; text-decoration: underline line-through">Formatted</span>
        <a href="tel:+123456789">Call</a>
        <img class="doc-image" src="data:image/png;base64,AA==" alt="Diagram" style="width: 900px; max-width: 100%; height: auto">
      </p>
    `)

    expect(sanitized).toContain('<h1 class="doc-title"><b>Title</b></h1>')
    expect(sanitized).toContain("font-family: 'Courier New', monospace")
    expect(sanitized).toContain('font-size: 48px')
    expect(sanitized).toContain('text-align: justify')
    expect(sanitized).toContain('href="tel:+123456789"')
    expect(sanitized).toContain('class="doc-image"')
    expect(sanitized).toContain('width: 900px')
  })

  it('accepts the double-quoted font families emitted by browser CSSOM', () => {
    const sanitized = sanitizeDocumentBlockHtml(`
      <p>
        <span style="font-family: Georgia, &quot;Times New Roman&quot;, serif">Serif</span>
        <span style="font-family: ui-monospace, &quot;SF Mono&quot;, Menlo, monospace">Mono</span>
        <span style="font-family: &quot;Courier New&quot;, monospace">Courier</span>
      </p>
    `)

    expect(sanitized).toContain(
      'font-family: Georgia, &quot;Times New Roman&quot;, serif',
    )
    expect(sanitized).toContain(
      'font-family: ui-monospace, &quot;SF Mono&quot;, Menlo, monospace',
    )
    expect(sanitized).toContain(
      'font-family: &quot;Courier New&quot;, monospace',
    )
  })

  it('rejects unbounded CSS, script URLs, and SVG data images', () => {
    const sanitized = sanitizeDocumentBlockHtml(`
      <p style="position: fixed; margin-left: 9999px; font-size: 999px">
        <a href="javascript:alert(1)">Unsafe</a>
        <img src="data:image/svg+xml;base64,PHN2Zz4=" onload="alert(1)">
      </p>
    `)

    expect(sanitized).toBe(
      '\n      <p>\n        <a>Unsafe</a>\n        <img>\n      </p>\n    ',
    )
  })
})
