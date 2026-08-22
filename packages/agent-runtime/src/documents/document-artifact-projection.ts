import { Context, Effect, Layer, Schema } from 'effect'
import { marked } from 'marked'
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
  'courier new, monospace',
  'georgia, serif',
  'georgia, times new roman, serif',
  'inter, sans-serif',
  'inter, system-ui, sans-serif',
  'ui-monospace, sf mono, menlo, monospace',
  'ui-sans-serif, system-ui, inter, sans-serif',
])

/** Makes browser-dependent CSSOM quote serialization irrelevant to allowlisting. */
const normalizeFontFamily = (value: string) =>
  value.replace(/["']/g, '').replace(/\s+/g, ' ').trim()

/** Validates supported CSS against the toolbar's exact bounded vocabulary. */
const safeStyleValue = (property: string, value: string) => {
  const normalized = value.trim().toLowerCase()
  if (['color', 'background-color'].includes(property)) {
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|transparent)$/i.test(
      normalized,
    )
  }
  if (property === 'font-family') {
    return SAFE_FONT_FAMILIES.has(normalizeFontFamily(normalized))
  }
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
  if (['text-decoration', 'text-decoration-line'].includes(property)) {
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
const sanitizeStyle = (value: string) => {
  const declarations = value.split(';').flatMap((declaration) => {
    const separator = declaration.indexOf(':')
    if (separator < 1) return []
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const propertyValue = declaration.slice(separator + 1).trim()
    if (!propertyValue || !safeStyleValue(property, propertyValue)) {
      return []
    }
    return [`${property}: ${propertyValue}`]
  })
  return declarations.length > 0 ? `${declarations.join('; ')};` : ''
}

/** Keeps only editor-supported markup and strips active-content attributes. */
const sanitizeElement = (element: HtmlElement) => {
  const tagName = element.tagName.toLowerCase()
  element.attrs = element.attrs.flatMap(({ name, value }) => {
    const attribute = name.toLowerCase()
    if (attribute.startsWith('on')) return []
    if (
      attribute === 'data-block-id' &&
      BLOCK_ELEMENTS.has(tagName) &&
      value.trim().length > 0 &&
      value.length <= 100
    ) {
      return [{ name, value }]
    }
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
 * regular expressions. Converter/parser output uses a small semantic
 * vocabulary; unknown containers are unwrapped so their text survives, while
 * active-content nodes are removed with their contents.
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

const TEXT_LINE_BREAK_ELEMENTS = new Set([
  'blockquote',
  'br',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'p',
  'pre',
  'tr',
])

/** Projects canonical editor HTML into model-searchable text without a DOM. */
export const documentBlocksToText = (
  blocks: ReadonlyArray<{ readonly html: string }>,
) =>
  blocks
    .map(({ html }) => {
      const fragment = parseFragment(html)
      const parts: string[] = []

      const visit = (node: HtmlNode): void => {
        if (node.nodeName === '#text' && 'value' in node) {
          parts.push(node.value)
          return
        }
        if (!isElement(node)) return
        const tagName = node.tagName.toLowerCase()
        if (tagName === 'img') {
          const alt = node.attrs.find(({ name }) => name === 'alt')?.value
          if (alt) parts.push(alt)
        }
        for (const child of node.childNodes) visit(child)
        if (tagName === 'td' || tagName === 'th') parts.push('\t')
        if (TEXT_LINE_BREAK_ELEMENTS.has(tagName)) parts.push('\n')
      }

      for (const child of fragment.childNodes) visit(child)
      return parts
        .join('')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    })
    .filter(Boolean)
    .join('\n\n')

/** Splits sanitized parser HTML into stable top-level collaboration blocks. */
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
export class DocumentArtifactImportError extends Schema.TaggedError<DocumentArtifactImportError>()(
  'DocumentArtifactImportError',
  {
    filename: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type DocumentMarkdownConversionResponse =
  | {
      readonly format: 'markdown' | 'text'
      readonly data: string
    }
  | {
      readonly format: 'error'
      readonly error: string
    }

/** Narrow Workers AI boundary needed by DOCX import and replaceable in tests. */
export interface DocumentMarkdownAi {
  readonly toMarkdown: (
    document: { readonly name: string; readonly blob: Blob },
    options?: {
      readonly conversionOptions?: {
        readonly output?: { readonly format?: 'markdown' | 'text' }
        readonly docx?: {
          readonly images?: { readonly convert?: boolean }
        }
      }
    },
  ) => Promise<DocumentMarkdownConversionResponse>
}

/**
 * Converter output is tagged with its markup format so the projection layer
 * knows whether `marked` must run. Workers AI yields Markdown; the offline
 * mammoth fallback is HTML-native, and converting its HTML to Markdown and
 * back would add a dependency and lose fidelity — the downstream structural
 * sanitizer remains the single authority over stored markup either way.
 */
export type DocumentMarkdownConversion = {
  readonly format: 'markdown' | 'html'
  readonly data: string
}

export interface DocumentMarkdownConverterService {
  readonly convertDocx: (
    filename: string,
    bytes: Uint8Array,
  ) => Effect.Effect<DocumentMarkdownConversion, DocumentArtifactImportError>
}

/** Owns the external Workers AI conversion boundary used by projections. */
export class DocumentMarkdownConverter extends Context.Service<
  DocumentMarkdownConverter,
  DocumentMarkdownConverterService
>()('@garden/documents/DocumentMarkdownConverter') {}

/**
 * Adapts Cloudflare's native document conversion exactly at the Workers AI
 * binding. The source DOCX remains untouched in R2; only returned Markdown is
 * projected into mutable editor state. Reference: Cloudflare OS
 * `packages/workshop-backend/src/web-fetch.ts` `convertToMarkdown` at HEAD.
 */
export const makeWorkersAiDocumentMarkdownLayer = (ai: DocumentMarkdownAi) =>
  Layer.succeed(
    DocumentMarkdownConverter,
    DocumentMarkdownConverter.of({
      convertDocx: Effect.fn('DocumentMarkdownConverter.convertDocx')(
        function* (filename: string, bytes: Uint8Array) {
          const result = yield* Effect.tryPromise({
            try: () =>
              ai.toMarkdown(
                {
                  name: filename,
                  blob: new Blob([Uint8Array.from(bytes)], {
                    type: DOCX_MEDIA_TYPE,
                  }),
                },
                {
                  conversionOptions: {
                    output: { format: 'markdown' },
                    docx: { images: { convert: false } },
                  },
                },
              ),
            catch: (cause) =>
              new DocumentArtifactImportError({
                filename,
                message: `Could not import ${filename} into editable blocks.`,
                cause,
              }),
          })
          if (result.format === 'error') {
            return yield* new DocumentArtifactImportError({
              filename,
              message: `Could not import ${filename} into editable blocks.`,
              cause: new Error(result.error),
            })
          }
          return { format: 'markdown', data: result.data } as const
        },
      ),
    }),
  )

/**
 * Offline/local DOCX converter: mammoth (already a dependency, same dynamic
 * import precedent as document-tools.ts extractDocumentText). Exists because
 * offline mode (`GARDEN_OFFLINE=1`, no Cloudflare account) must never invoke
 * the Workers AI binding — with remote bindings disabled it throws on use.
 * Mammoth emits HTML, surfaced as `format: 'html'` so the projection skips
 * `marked` and feeds the sanitizer directly.
 */
export const makeMammothDocumentMarkdownLayer = () =>
  Layer.succeed(
    DocumentMarkdownConverter,
    DocumentMarkdownConverter.of({
      convertDocx: Effect.fn('DocumentMarkdownConverter.convertDocx')(
        function* (filename: string, bytes: Uint8Array) {
          const html = yield* Effect.tryPromise({
            try: async () => {
              const mammoth = await import('mammoth')
              const result = await mammoth.convertToHtml({
                buffer: Buffer.from(bytes),
              })
              return result.value
            },
            catch: (cause) =>
              new DocumentArtifactImportError({
                filename,
                message: `Could not import ${filename} into editable blocks.`,
                cause,
              }),
          })
          return { format: 'html', data: html } as const
        },
      ),
    }),
  )

/**
 * Selects the DOCX converter for the current environment: Workers AI normally,
 * mammoth when offline mode is active (the AI binding would throw if invoked
 * with remote bindings disabled — see makeMammothDocumentMarkdownLayer).
 */
export const documentMarkdownLayerForEnv = (env: {
  GARDEN_OFFLINE?: string
  AI: DocumentMarkdownAi
}) =>
  // Non-empty GARDEN_OFFLINE = offline (wrangler vars default it to "").
  (env.GARDEN_OFFLINE ?? '').trim() !== ''
    ? makeMammothDocumentMarkdownLayer()
    : makeWorkersAiDocumentMarkdownLayer(env.AI)

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
 * Converts Cloudflare Markdown to safe canonical HTML blocks. `marked` owns
 * CommonMark/GFM parsing; the existing structural sanitizer remains the only
 * authority over markup stored in the editable projection.
 */
export const documentArtifactProjectionLayer = Layer.effect(
  DocumentArtifactProjection,
  Effect.gen(function* () {
    const converter = yield* DocumentMarkdownConverter
    return DocumentArtifactProjection.of({
      importDocx: Effect.fn('DocumentArtifactProjection.importDocx')(function* (
        filename: string,
        bytes: Uint8Array,
      ) {
        const conversion = yield* converter.convertDocx(filename, bytes)
        const html =
          conversion.format === 'html'
            ? conversion.data
            : marked.parse(conversion.data, { async: false })
        const title =
          filename
            .replace(/\.docx$/i, '')
            .trim()
            .slice(0, 500) || 'Document'
        return InitialDocument.make({
          title,
          blocks: htmlToDocumentBlocks(html),
        })
      }),
    })
  }),
)
