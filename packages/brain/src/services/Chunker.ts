import { Context, Effect, Layer } from 'effect'
import type { ExtractedDoc, FileFormat } from './Extractor.ts'

export type Chunk = {
  readonly title: string
  readonly body: string
  readonly path?: string
}

export type ChunkOptions = {
  readonly size: number
  readonly overlap: number
}

const DEFAULT_OPTIONS: ChunkOptions = { size: 1000, overlap: 100 }

const headingInfo = (
  line: string,
): { readonly depth: number; readonly title: string } | null => {
  const match = line.match(/^(#{1,6})\s+(.*)$/)
  if (match === null) return null
  return { depth: match[1]!.length, title: (match[2] ?? '').trim() }
}

const breadcrumbBody = (path: string, body: string): string =>
  body === '' ? path : `${path}\n\n${body}`

/**
 * Splits structured documents without discarding text before the first heading.
 * Previously that preamble vanished; it now becomes a breadcrumbed chunk when
 * the document also contains headings, while heading-free input uses fallback.
 */
export const splitHeadings = (
  body: string,
  options: ChunkOptions = DEFAULT_OPTIONS,
  rootTitle?: string,
): readonly Chunk[] => {
  const { size } = options
  const sections: { title: string; body: string; path: string }[] = []
  const chain: string[] = rootTitle === undefined ? [] : [rootTitle]
  let current: { title: string; body: string; path: string } | null = null
  let preamble = ''
  for (const line of body.split('\n')) {
    const info = headingInfo(line)
    if (info !== null) {
      if (current !== null) sections.push(current)
      if (preamble !== '') {
        sections.unshift({
          title: rootTitle ?? 'Preamble',
          body: preamble,
          path: rootTitle ?? 'Preamble',
        })
        preamble = ''
      }
      chain.length = info.depth
      chain[info.depth - 1] = info.title
      current = { title: info.title, body: '', path: chain.join(' > ') }
    } else if (current !== null) {
      current.body = current.body === '' ? line : `${current.body}\n${line}`
    } else {
      preamble = preamble === '' ? line : `${preamble}\n${line}`
    }
  }
  if (current !== null) sections.push(current)
  return sections.flatMap((section) => {
    const combined = breadcrumbBody(section.path, section.body)
    if (combined.length <= size) {
      return [
        {
          title: section.title,
          body: combined,
          path: section.path,
        },
      ]
    }
    const breadcrumbLength = section.path.length + 2
    const bodySize = Math.max(1, size - breadcrumbLength)
    const bodyOverlap = Math.min(options.overlap, bodySize - 1)
    return chunkBySize(section.body, {
      size: bodySize,
      overlap: bodyOverlap,
    }).map((part, i) => ({
      title: i === 0 ? section.title : `${section.title} (${i + 1})`,
      body: breadcrumbBody(section.path, part.body),
      path: i === 0 ? section.path : `${section.path} (${i + 1})`,
    }))
  })
}

const chunkBody = (body: string): readonly string[] => {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
  return paragraphs
}

const takeTail = (text: string, overlap: number): string => {
  if (overlap === 0) return ''
  const words = text.split(/\s+/)
  let tail = ''
  for (let i = words.length - 1; i >= 0 && tail.length < overlap; i--) {
    tail = `${words[i]} ${tail}`.trim()
  }
  return tail.length <= overlap ? tail : tail.slice(-overlap)
}

/**
 * Chunks every paragraph byte range while retaining bounded word overlap.
 * Previously an oversized paragraph emitted its prefix then replaced the
 * remainder with overlap text, silently dropping all later content.
 */
export const chunkBySize = (
  body: string,
  options: ChunkOptions = DEFAULT_OPTIONS,
): readonly Chunk[] => {
  const { size, overlap } = options
  if (size <= 0 || overlap < 0 || overlap >= size) {
    throw new Error(
      'chunk size must be positive and overlap must satisfy 0 <= overlap < size',
    )
  }
  const paragraphs = chunkBody(body)
  const chunks: Chunk[] = []
  let current = ''
  const pushChunk = (text: string) => {
    if (text !== '')
      chunks.push({ title: `Part ${chunks.length + 1}`, body: text })
  }
  for (const paragraph of paragraphs) {
    while (
      current !== '' &&
      current.length + paragraph.length + 2 > size &&
      current.length < size
    ) {
      pushChunk(current)
      current = takeTail(current, overlap)
    }
    if (current === '') {
      current = paragraph
    } else {
      current = `${current}\n\n${paragraph}`
    }
    while (current.length > size) {
      const emitted = current.slice(0, size)
      const remainder = current.slice(size)
      pushChunk(emitted)
      const tail = takeTail(emitted, overlap)
      current =
        tail === ''
          ? remainder
          : remainder === ''
            ? tail
            : `${tail}\n\n${remainder}`
    }
  }
  pushChunk(current)
  return chunks
}

const chunkStructured = (
  body: string,
  options: ChunkOptions = DEFAULT_OPTIONS,
  rootTitle?: string,
): readonly Chunk[] => {
  const chunks = splitHeadings(body, options, rootTitle)
  if (chunks.length > 0) return chunks
  return chunkBySize(body, options)
}

export const chunkForFormat = (
  format: FileFormat,
  body: string,
  options: ChunkOptions = DEFAULT_OPTIONS,
  rootTitle?: string,
): readonly Chunk[] => {
  switch (format) {
    case 'markdown':
    case 'docx':
    case 'xlsx':
      return chunkStructured(body, options, rootTitle)
    default:
      return chunkBySize(body, options)
  }
}

export type ChunkerShape = {
  readonly chunk: (
    doc: ExtractedDoc,
    options?: ChunkOptions,
  ) => Effect.Effect<readonly Chunk[], never>
}

export class Chunker extends Context.Service<Chunker, ChunkerShape>()(
  '@garden/brain/Chunker',
) {}

export const ChunkerLive = Layer.succeed(
  Chunker,
  Chunker.of({
    chunk: (doc, options) =>
      Effect.succeed(chunkForFormat(doc.format, doc.body, options, doc.title)),
  }),
)
