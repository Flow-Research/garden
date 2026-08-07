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
  'b',
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
    normalized.startsWith('tel:') ||
    normalized.startsWith('/') ||
    normalized.startsWith('#')
  )
}

/** Matches only reload-safe raster formats accepted by Workspace Docs. */
const safeImageSource = (value: string) =>
  /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value.trim())

const SAFE_FONT_FAMILIES = new Set([
  'arial, sans-serif',
  "'courier new', monospace",
  'georgia, serif',
  "georgia, 'times new roman', serif",
  'inter, sans-serif',
  'inter, system-ui, sans-serif',
  "ui-monospace, 'sf mono', menlo, monospace",
  'ui-sans-serif, system-ui, inter, sans-serif',
])

/** Validates supported CSS against the toolbar's exact bounded vocabulary. */
const safeStyleValue = (property: string, value: string) => {
  const normalized = value.trim().toLowerCase()
  if (['color', 'background-color'].includes(property)) {
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|transparent)$/i.test(
      normalized,
    )
  }
  if (property === 'font-family') return SAFE_FONT_FAMILIES.has(normalized)
  if (property === 'font-size') {
    const pixels = normalized.match(/^(\d+(?:\.\d+)?)px$/)?.[1]
    return Boolean(pixels && Number(pixels) >= 8 && Number(pixels) <= 96)
  }
  if (property === 'font-style')
    return ['italic', 'normal'].includes(normalized)
  if (property === 'font-weight')
    return /^(normal|bold|[1-9]00)$/.test(normalized)
  if (property === 'text-align') {
    return ['left', 'center', 'right', 'justify', 'start', 'end'].includes(
      normalized,
    )
  }
  if (property === 'text-decoration') {
    return /^(none|underline|line-through|underline line-through|line-through underline)$/.test(
      normalized,
    )
  }
  if (property === 'height') return normalized === 'auto'
  if (['width', 'max-width', 'margin-left'].includes(property)) {
    if (normalized === '100%' && property !== 'margin-left') return true
    const pixels = normalized.match(/^(\d+(?:\.\d+)?)px$/)?.[1]
    const maximum = property === 'margin-left' ? 320 : 1600
    return Boolean(pixels && Number(pixels) >= 0 && Number(pixels) <= maximum)
  }
  return false
}

/**
 * Keeps the inert inline declarations emitted by Cloudflare's native editing
 * commands while rejecting URL-bearing and executable CSS values.
 */
const sanitizeStyle = (value: string) =>
  value
    .split(';')
    .flatMap((declaration) => {
      const separator = declaration.indexOf(':')
      if (separator < 1) return []
      const property = declaration.slice(0, separator).trim().toLowerCase()
      const propertyValue = declaration.slice(separator + 1).trim()
      if (!propertyValue || !safeStyleValue(property, propertyValue)) {
        return []
      }
      return [`${property}: ${propertyValue}`]
    })
    .join('; ')

/** Keeps only editor-supported markup and strips active-content attributes. */
const sanitizeElement = (element: HtmlElement) => {
  const tagName = element.tagName.toLowerCase()
  element.attrs = element.attrs.flatMap(({ name, value }) => {
    const attribute = name.toLowerCase()
    if (attribute.startsWith('on')) return []
    if (attribute === 'style') {
      const sanitized = sanitizeStyle(value)
      return sanitized ? [{ name, value: sanitized }] : []
    }
    if (tagName === 'h1' && attribute === 'class' && value === 'doc-title') {
      return [{ name, value }]
    }
    if (tagName === 'img' && attribute === 'class' && value === 'doc-image') {
      return [{ name, value }]
    }
    if (tagName === 'a' && attribute === 'href') {
      return safeUrl(value) ? [{ name, value }] : []
    }
    if (tagName === 'img' && attribute === 'src') {
      return safeImageSource(value) ? [{ name, value }] : []
    }
    if (tagName === 'img') {
      return ['alt', 'height', 'title', 'width'].includes(attribute)
        ? [{ name, value }]
        : []
    }
    if (['td', 'th'].includes(tagName)) {
      return ['colspan', 'rowspan'].includes(attribute) ? [{ name, value }] : []
    }
    return []
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
