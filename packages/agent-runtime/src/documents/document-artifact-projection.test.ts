import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DocumentArtifactProjection,
  type DocumentMarkdownAi,
  documentArtifactProjectionLayer,
  htmlToDocumentBlocks,
  makeWorkersAiDocumentMarkdownLayer,
  sanitizeDocumentBlockHtml,
} from './document-artifact-projection'

const projectionLayer = (ai: DocumentMarkdownAi) =>
  documentArtifactProjectionLayer.pipe(
    Layer.provide(makeWorkersAiDocumentMarkdownLayer(ai)),
  )

/** Runs DOCX projection with a per-test Workers AI binding. */
const importDocx = (ai: DocumentMarkdownAi, filename = 'Launch plan.docx') =>
  Effect.runPromise(
    Effect.gen(function* () {
      const projection = yield* DocumentArtifactProjection
      return yield* projection.importDocx(
        filename,
        Uint8Array.from([80, 75, 3, 4]),
      )
    }).pipe(Effect.provide(projectionLayer(ai))),
  )

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
      '<p style="text-align: center;"><span style="font-family: Georgia, serif; font-size: 18px; color: #123456;">Styled</span></p>',
    )
  })

  it('round-trips Workspace Docs block identity and Chromium underline CSS', () => {
    const sanitized = sanitizeDocumentBlockHtml(
      '<p data-block-id="b_editor"><span style="text-decoration-line: underline">Underlined</span></p>',
    )

    expect(sanitized).toBe(
      '<p data-block-id="b_editor"><span style="text-decoration-line: underline;">Underlined</span></p>',
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

describe('DocumentArtifactProjection', () => {
  it('uses the Workers AI DOCX converter and parses its Markdown safely', async () => {
    const requests: Array<{
      readonly name: string
      readonly mediaType: string
      readonly bytes: number[]
      readonly convertImages: boolean | undefined
    }> = []
    const ai: DocumentMarkdownAi = {
      toMarkdown: async (document, options) => {
        requests.push({
          name: document.name,
          mediaType: document.blob.type,
          bytes: [...new Uint8Array(await document.blob.arrayBuffer())],
          convertImages: options?.conversionOptions?.docx?.images?.convert,
        })
        return {
          format: 'markdown',
          data: '# Imported plan\n\nA **bold** paragraph with [unsafe](javascript:alert(1)).\n\n<script>steal()</script>',
        }
      },
    }

    const projected = await importDocx(ai)

    expect(requests).toEqual([
      {
        name: 'Launch plan.docx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: [80, 75, 3, 4],
        convertImages: false,
      },
    ])
    expect(projected.title).toBe('Launch plan')
    expect(projected.blocks.map(({ html }) => html)).toEqual([
      '<h1>Imported plan</h1>',
      '<p>A <strong>bold</strong> paragraph with <a>unsafe</a>.</p>',
    ])
  })

  it('returns Cloudflare conversion errors as typed import failures', async () => {
    const ai: DocumentMarkdownAi = {
      toMarkdown: async () => ({
        format: 'error',
        error: 'Unsupported document archive',
      }),
    }

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const projection = yield* DocumentArtifactProjection
        return yield* projection
          .importDocx('broken.docx', Uint8Array.from([1]))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(projectionLayer(ai))),
    )

    expect(failure).toMatchObject({
      _tag: 'DocumentArtifactImportError',
      filename: 'broken.docx',
      message: 'Could not import broken.docx into editable blocks.',
    })
  })
})
