import { Context, Effect, Layer, Schema } from 'effect'
import { Buffer } from 'node:buffer'
import {
  parseFragment,
  serializeOuter,
  type DefaultTreeAdapterMap,
} from 'parse5'
import {
  InitialDocument,
  type InitialDocument as InitialDocumentValue,
} from './document-artifact-model'

type HtmlNode = DefaultTreeAdapterMap['childNode']
type HtmlElement = DefaultTreeAdapterMap['element']
type HtmlParent = DefaultTreeAdapterMap['parentNode']

const ALLOWED_ELEMENTS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
const DROP_WITH_CONTENT = new Set([
  'embed',
  'iframe',
  'link',
  'meta',
  'object',
  'script',
  'style',
])
const BLOCK_ELEMENTS = new Set([
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'ol',
  'p',
  'pre',
  'table',
  'ul',
])

const isElement = (node: HtmlNode): node is HtmlElement =>
  'tagName' in node && typeof node.tagName === 'string'

const safeUrl = (value: string) => {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('/') ||
    normalized.startsWith('#')
  )
}

const safeImageSource = (value: string) =>
  value.trim().toLowerCase().startsWith('data:image/') || safeUrl(value)

/** Keeps only editor-supported markup and strips active-content attributes. */
const sanitizeElement = (element: HtmlElement) => {
  const tagName = element.tagName.toLowerCase()
  element.attrs = element.attrs.filter(({ name, value }) => {
    const attribute = name.toLowerCase()
    if (attribute.startsWith('on') || attribute === 'style') return false
    if (tagName === 'a' && attribute === 'href') return safeUrl(value)
    if (tagName === 'img' && attribute === 'src') return safeImageSource(value)
    if (tagName === 'img') {
      return ['alt', 'height', 'title', 'width'].includes(attribute)
    }
    if (['td', 'th'].includes(tagName)) {
      return ['colspan', 'rowspan'].includes(attribute)
    }
    return false
  })
}

/**
 * Sanitizes a parsed fragment structurally rather than rewriting HTML with
 * regular expressions. Mammoth emits a small semantic vocabulary; unknown
 * containers are unwrapped so their text survives, while active-content nodes
 * are removed with their contents.
 */
const sanitizeChildren = (parent: HtmlParent): void => {
  const next: HtmlNode[] = []
  for (const child of parent.childNodes) {
    if (!isElement(child)) {
      if (child.nodeName === '#text') next.push(child)
      continue
    }
    const tagName = child.tagName.toLowerCase()
    if (DROP_WITH_CONTENT.has(tagName)) continue
    sanitizeChildren(child)
    if (!ALLOWED_ELEMENTS.has(tagName)) {
      next.push(...child.childNodes)
      continue
    }
    sanitizeElement(child)
    next.push(child)
  }
  parent.childNodes = next
}

/** Normalizes one canonical block to the server's safe editor vocabulary. */
export const sanitizeDocumentBlockHtml = (html: string) => {
  const fragment = parseFragment(html)
  sanitizeChildren(fragment)
  return fragment.childNodes.map((node) => serializeOuter(node)).join('')
}

/** Splits sanitized Mammoth HTML into stable top-level collaboration blocks. */
export const htmlToDocumentBlocks = (html: string) => {
  const fragment = parseFragment(html)
  sanitizeChildren(fragment)
  const blocks: Array<{ id: string; html: string }> = []
  let inline: HtmlNode[] = []

  const flushInline = () => {
    const value = inline
      .map((node) => serializeOuter(node))
      .join('')
      .trim()
    inline = []
    if (!value) return
    blocks.push({ id: crypto.randomUUID(), html: `<p>${value}</p>` })
  }

  for (const child of fragment.childNodes) {
    if (isElement(child) && BLOCK_ELEMENTS.has(child.tagName.toLowerCase())) {
      flushInline()
      const value = serializeOuter(child).trim()
      if (value) blocks.push({ id: crypto.randomUUID(), html: value })
      continue
    }
    inline.push(child)
  }
  flushInline()
  return blocks.length > 0
    ? blocks
    : [{ id: crypto.randomUUID(), html: '<p></p>' }]
}

/** DOCX import failure at the external converter boundary. */
export class DocumentArtifactImportError extends Schema.TaggedErrorClass<DocumentArtifactImportError>()(
  'DocumentArtifactImportError',
  {
    filename: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface DocumentArtifactProjectionService {
  readonly importDocx: (
    filename: string,
    bytes: Uint8Array,
  ) => Effect.Effect<InitialDocumentValue, DocumentArtifactImportError>
}

/** Office-file adapter; canonical editing remains independent of DOCX bytes. */
export class DocumentArtifactProjection extends Context.Service<
  DocumentArtifactProjection,
  DocumentArtifactProjectionService
>()('@garden/documents/DocumentArtifactProjection') {}

/**
 * Converts DOCX through Mammoth, matching Cloudflare OS's ingest-then-edit
 * direction while preserving the uploaded binary as an immutable source.
 */
export const documentArtifactProjectionLayer: Layer.Layer<DocumentArtifactProjection> =
  Layer.succeed(
    DocumentArtifactProjection,
    DocumentArtifactProjection.of({
      importDocx: Effect.fn('DocumentArtifactProjection.importDocx')(function* (
        filename: string,
        bytes: Uint8Array,
      ) {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const mammoth = await import('mammoth')
            return await mammoth.convertToHtml({
              buffer: Buffer.from(bytes),
            })
          },
          catch: (cause) =>
            new DocumentArtifactImportError({
              filename,
              message: `Could not import ${filename} into editable blocks.`,
              cause,
            }),
        })
        const title =
          filename
            .replace(/\.docx$/i, '')
            .trim()
            .slice(0, 500) || 'Document'
        return InitialDocument.make({
          title,
          blocks: htmlToDocumentBlocks(result.value),
        })
      }),
    }),
  )
