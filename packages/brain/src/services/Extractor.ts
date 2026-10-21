import { FileSystem } from 'effect/FileSystem'
import { Effect, Layer } from 'effect'
import type ExcelJS from 'exceljs'
import { ExtractError } from '../errors.ts'
import { Extractor, FileFormat, formatOf } from './ExtractorService.ts'

// Parser libraries (unpdf, mammoth, exceljs) are loaded lazily per format. They
// are CJS-heavy and Vite pre-bundles them into the SSR dep graph that the
// workerd runner evaluates on every request; exceljs's vendored readable-stream
// does `__require("process/")` there, which throws (`Calling require for
// "process/"`) and 500s every route. Dynamic import keeps them out of the
// worker entry graph so the app boots; each parser only loads when its format
// is actually extracted.

export {
  Extractor,
  FileFormat,
  formatOf,
  type ExtractedDoc,
  type ExtractorShape,
} from './ExtractorService.ts'

const fsTag = FileSystem

export const titleFromPath = (path: string): string => {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  if (value instanceof Date) return value.toISOString()
  if ('richText' in value) return value.richText.map((t) => t.text).join('')
  if ('text' in value) return value.text
  if ('result' in value) return String(value.result ?? '')
  if ('error' in value) return value.error
  return ''
}

export const extractText = (
  path: string,
  bytes: Uint8Array,
  format: FileFormat,
): Effect.Effect<string, ExtractError> =>
  Effect.tryPromise({
    try: async () => {
      switch (format) {
        case FileFormat.Text:
        case FileFormat.Markdown:
          return new TextDecoder().decode(bytes)
        case FileFormat.Pdf: {
          const { extractText: extractPdfText, getDocumentProxy } =
            await import('unpdf')
          const pdf = await getDocumentProxy(new Uint8Array(bytes))
          const { text } = await extractPdfText(pdf, { mergePages: true })
          return text
        }
        case FileFormat.Docx: {
          const { default: mammoth } = await import('mammoth')
          const markdown = mammoth as typeof mammoth & {
            convertToMarkdown: (input: {
              buffer: Buffer
            }) => Promise<{ value: string }>
          }
          const result = await markdown.convertToMarkdown({
            buffer: Buffer.from(bytes) as Buffer,
          })
          return result.value
        }
        case FileFormat.Xlsx: {
          const { default: ExcelJS } = await import('exceljs')
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
          const sheets: string[] = []
          workbook.eachSheet((sheet) => {
            if (sheet.state === 'hidden' || sheet.state === 'veryHidden') return
            const rows: string[] = []
            sheet.eachRow({ includeEmpty: false }, (row) => {
              const cells: string[] = []
              row.eachCell({ includeEmpty: true }, (cell) => {
                cells.push(cellText(cell.value))
              })
              if (cells.some((value) => value.trim() !== ''))
                rows.push(cells.join('\t'))
            })
            sheets.push(`## ${sheet.name}\n${rows.join('\n')}`)
          })
          return sheets.join('\n\n')
        }
        default:
          throw new Error(`unsupported format ${format}`)
      }
    },
    catch: (cause) =>
      new ExtractError({
        message: `failed to extract text from ${path}`,
        cause,
      }),
  })

export const ExtractorLive = Layer.effect(
  Extractor,
  Effect.gen(function* () {
    const fs = yield* fsTag
    return Extractor.of({
      extract: (path) =>
        Effect.gen(function* () {
          const format = formatOf(path)
          if (format === null) {
            return yield* Effect.fail(
              new ExtractError({ message: `unsupported file type: ${path}` }),
            )
          }
          const bytes = yield* fs.readFile(path).pipe(
            Effect.mapError(
              (cause) =>
                new ExtractError({
                  message: `failed to read ${path}`,
                  cause,
                }),
            ),
          )
          const body = yield* extractText(path, bytes, format)
          return { path, title: titleFromPath(path), body, format }
        }),
      extractFromBytes: (path, bytes) =>
        Effect.gen(function* () {
          const format = formatOf(path)
          if (format === null) {
            return yield* Effect.fail(
              new ExtractError({ message: `unsupported file type: ${path}` }),
            )
          }
          const body = yield* extractText(path, bytes, format)
          return { path, title: titleFromPath(path), body, format }
        }),
    })
  }),
)
