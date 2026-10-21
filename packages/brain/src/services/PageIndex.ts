import { FileSystem } from 'effect/FileSystem'
import { Context, Effect, Layer } from 'effect'
import { DateTime } from 'effect'
import type { NewBrainItem, WorkspaceId } from '../domain/items.ts'
import { Kind } from '../domain/items.ts'
import { HelixError } from '../errors.ts'
import { Chunker, type ChunkerShape } from './Chunker.ts'
import {
  Extractor,
  formatOf,
  type ExtractedDoc as ExtractedContent,
  type FileFormat,
} from './Extractor.ts'

const fsTag = FileSystem

export type ExtractedDoc = {
  readonly format: FileFormat
  readonly note: NewBrainItem
  readonly sections: readonly NewBrainItem[]
}

export type PageIndexShape = {
  readonly load: (
    dir: string,
    workspaceId: WorkspaceId,
  ) => Effect.Effect<readonly ExtractedDoc[], HelixError>
}

export class PageIndex extends Context.Service<PageIndex, PageIndexShape>()(
  '@garden/brain/PageIndex',
) {}

type Frontmatter = {
  readonly title?: string
  readonly author?: string
}

const parseFrontmatter = (
  raw: string,
): { readonly meta: Frontmatter; readonly body: string } => {
  const trimmed = raw.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) return { meta: {}, body: trimmed }
  const end = trimmed.indexOf('\n---')
  if (end === -1) return { meta: {}, body: trimmed }
  const header = trimmed.slice(3, end)
  const meta: { title?: string; author?: string } = {}
  for (const line of header.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)\s*$/)
    if (match === null) continue
    if (match[1] === 'title') meta.title = match[2]
    if (match[1] === 'author') meta.author = match[2]
  }
  return { meta, body: trimmed.slice(end + 4) }
}

const toItem = (
  doc: ExtractedContent,
  workspaceId: WorkspaceId,
  chunker: ChunkerShape,
): Effect.Effect<ExtractedDoc, never> =>
  Effect.gen(function* () {
    const at = DateTime.makeUnsafe(new Date())
    const origin = {
      actor: { _tag: 'Human' as const, userId: 'page-index' },
      at,
    } as const
    let title = doc.title
    let body = doc.body
    if (doc.format === 'markdown') {
      const { meta, body: mdBody } = parseFrontmatter(doc.body)
      title = meta.title ?? title
      body = mdBody
    }
    const note: NewBrainItem = {
      tenantId: workspaceId,
      kind: Kind.make('file'),
      label: title,
      r2Key: doc.path,
      canonical: { type: 'file', value: doc.path },
      body,
      origin,
    }
    const chunks = yield* chunker.chunk({ ...doc, body })
    const sections = chunks.map(
      (chunk): NewBrainItem => ({
        tenantId: workspaceId,
        kind: Kind.make('section'),
        label: chunk.title,
        r2Key: doc.path,
        body: chunk.body,
        origin,
      }),
    )
    return { format: doc.format, note, sections }
  })

export const PageIndexLive = Layer.effect(
  PageIndex,
  Effect.gen(function* () {
    const fs = yield* fsTag
    const extractor = yield* Extractor
    const chunker = yield* Chunker
    return PageIndex.of({
      load: (dir, workspaceId) =>
        Effect.gen(function* () {
          const names = yield* fs.readDirectory(dir)
          const files = yield* Effect.forEach(
            names.filter((name) => formatOf(name) !== null).sort(),
            (name) => extractor.extract(`${dir}/${name}`),
          )
          return yield* Effect.forEach(files, (doc) =>
            toItem(doc, workspaceId, chunker),
          )
        }).pipe(
          Effect.mapError(
            (cause) =>
              new HelixError({
                message: `failed to load page index ${dir}`,
                cause,
              }),
          ),
        ),
    })
  }),
)
