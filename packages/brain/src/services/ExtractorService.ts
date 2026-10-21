import { Context, Effect } from 'effect'
import { ExtractError } from '../errors.ts'

export const FileFormat = {
  Markdown: 'markdown',
  Pdf: 'pdf',
  Docx: 'docx',
  Xlsx: 'xlsx',
  Text: 'text',
} as const
export type FileFormat = (typeof FileFormat)[keyof typeof FileFormat]

export type ExtractedDoc = {
  readonly path: string
  readonly title: string
  readonly body: string
  readonly format: FileFormat
}

export type ExtractorShape = {
  readonly extract: (path: string) => Effect.Effect<ExtractedDoc, ExtractError>
  readonly extractFromBytes: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<ExtractedDoc, ExtractError>
}

export class Extractor extends Context.Service<Extractor, ExtractorShape>()(
  '@garden/brain/Extractor',
) {}

const extensionOf = (path: string): string => {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

export const formatOf = (path: string): FileFormat | null => {
  switch (extensionOf(path)) {
    case 'md':
      return FileFormat.Markdown
    case 'pdf':
      return FileFormat.Pdf
    case 'docx':
      return FileFormat.Docx
    case 'xlsx':
      return FileFormat.Xlsx
    case 'txt':
      return FileFormat.Text
    default:
      return null
  }
}
