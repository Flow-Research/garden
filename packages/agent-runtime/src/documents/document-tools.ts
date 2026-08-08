import { Buffer } from 'node:buffer'
import type { WorkspaceFsLike } from '@cloudflare/shell'
import { and, desc, eq, or } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { Result, TaggedError } from 'better-result'
import * as schema from '@garden/db/schema'
import {
  DocumentArtifactRpcError,
  DocumentOperation,
  type DocumentBlockDeletion,
  type DocumentBlockUpsert,
  type DocumentOperationOutcome,
  type DocumentSnapshot,
} from './document-artifact-model'
import { documentBlocksToText } from './document-artifact-projection'
import { documentDownloadUrl } from './document-storage'

export class DocumentToolError extends TaggedError('DocumentToolError')<{
  message: string
}>() {}

type DocumentArtifactAuthorityFailure = {
  ok: false
  error: DocumentArtifactRpcError
}

type DocumentArtifactReadResult =
  | { ok: true; snapshot: DocumentSnapshot }
  | DocumentArtifactAuthorityFailure

type DocumentArtifactApplyResult =
  | { ok: true; outcome: DocumentOperationOutcome }
  | DocumentArtifactAuthorityFailure

/**
 * Narrow capability passed by the owning ChatSubAgent facet. Document tools
 * can read, initialize, and mutate canonical blocks, but cannot reach Durable
 * Object storage or construct a second authority.
 */
export type DocumentArtifactToolAuthority = {
  read: (documentId: string) => Promise<DocumentArtifactReadResult>
  apply: (
    documentId: string,
    operation: typeof DocumentOperation.Type,
  ) => Promise<DocumentArtifactApplyResult>
  initializeDocx: (input: {
    bytes: Uint8Array
    documentId: string
    filename: string
  }) => Promise<DocumentArtifactReadResult>
}

export type DocumentToolContext = {
  documentArtifacts?: DocumentArtifactToolAuthority
  databaseUrl: string
  workspace: WorkspaceFsLike
  threadId: string
}

/** Converts the private RPC error union into bounded model-facing guidance. */
function documentArtifactErrorMessage(error: DocumentArtifactRpcError): string {
  return DocumentArtifactRpcError.match<string>(error, {
    DocumentArtifactValidationError: ({ message }) => message,
    DocumentArtifactPersistenceError: () =>
      'The editable document could not be saved.',
    DocumentArtifactNotFoundError: () =>
      'The editable document has not been initialized.',
    DocumentArtifactAlreadyExistsError: () =>
      'The editable document is already initialized.',
    DocumentArtifactImportError: () =>
      'The DOCX could not be imported into the editable document.',
  })
}

type DocumentSection = {
  heading?: string
  level?: number
  content?: string
  pageBreak?: boolean
  table?: { headers: string[]; rows: string[][] }
}

export type GenerateDocxPageSize = 'letter' | 'a4'

export type GenerateDocxOptions = {
  pageSize?: GenerateDocxPageSize
  font?: string
  header?: string
  footer?: string
  pageNumbers?: boolean
}

const PAGE_DIMENSIONS_DXA = {
  letter: { width: 12240, height: 15840 },
  a4: { width: 11906, height: 16838 },
} as const

const DEFAULT_FONT = 'Times New Roman'

function parseInlineRuns(
  text: string,
  baseRun: { font: string; size: number },
): InstanceType<typeof TextRun>[] {
  if (!text) return []
  const runs: InstanceType<typeof TextRun>[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) {
      runs.push(new TextRun({ text: text.slice(cursor, start), ...baseRun }))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      runs.push(
        new TextRun({ text: token.slice(2, -2), bold: true, ...baseRun }),
      )
    } else {
      runs.push(
        new TextRun({ text: token.slice(1, -1), italics: true, ...baseRun }),
      )
    }
    cursor = start + token.length
  }
  if (cursor < text.length) {
    runs.push(new TextRun({ text: text.slice(cursor), ...baseRun }))
  }
  return runs
}

/**
 * Resolves the document-tools Drizzle client through Hyperdrive's pooled
 * connection string. Callers pass `env.HYPERDRIVE.connectionString`. Previously
 * called `drizzle(databaseUrl)` from the neon-serverless driver, opening a fresh
 * direct-to-Neon WebSocket pool per call that bypassed Hyperdrive, never closed,
 * and defeated Neon autosuspend. `getPooledDb` memoizes one node-postgres pool
 * per connection string per isolate so Hyperdrive owns origin pooling.
 */
function getDb(databaseUrl: string) {
  return getPooledDb(databaseUrl)
}

/**
 * Recovers image media types that the document table's coarse `fileType`
 * cannot represent. Uploaded images were previously returned as generic
 * octet-stream artifacts, so Think could not emit an image model part.
 */
function mediaTypeFromFilename(filename: string) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return null
}

/**
 * Produces the media type exposed by artifacts, downloads, and model reads.
 * Filename inspection is intentionally limited to image formats; established
 * document file-type mappings remain the canonical source for all other files.
 */
function contentTypeForFileType(fileType: string, filename?: string) {
  const filenameMediaType =
    fileType === 'unknown' && filename ? mediaTypeFromFilename(filename) : null
  if (filenameMediaType) return filenameMediaType
  switch (fileType) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'doc':
      return 'application/msword'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
    case 'md':
      return 'text/plain; charset=utf-8'
    case 'json':
      return 'application/json'
    case 'csv':
      return 'text/csv'
    default:
      return 'application/octet-stream'
  }
}

function normalizeWorkspaceFilename(filename: string) {
  const trimmed = filename.trim() || 'document'
  return Array.from(trimmed, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 || char === '/' || char === '\\'
      ? '_'
      : char
  }).join('')
}

/** Keeps artifact cards aligned with the media type used for stored bytes. */
function buildArtifact(args: {
  documentId: string
  filename: string
  fileType: string
  versionId: string
  versionNumber: number
  mediaType?: string | null
}) {
  return {
    kind: 'document' as const,
    id: args.documentId,
    filename: args.filename,
    mediaType:
      args.mediaType ?? contentTypeForFileType(args.fileType, args.filename),
    url: documentDownloadUrl(args.documentId, args.filename),
    content: null,
    versionId: args.versionId,
    versionNumber: args.versionNumber,
  }
}

async function loadThreadContext(context: DocumentToolContext) {
  const db = getDb(context.databaseUrl)
  const rowResult = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          threadId: schema.chatThread.id,
          workspaceId: schema.chatThread.workspaceId,
          ownerUserId: schema.chatThread.ownerUserId,
        })
        .from(schema.chatThread)
        .where(
          or(
            eq(schema.chatThread.id, context.threadId),
            eq(schema.chatThread.runtimeKey, context.threadId),
          ),
        )
        .limit(1)
      return row ?? null
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (rowResult.isErr()) return rowResult
  if (!rowResult.value) {
    return Result.err(
      new DocumentToolError({ message: 'Chat thread not found.' }),
    )
  }
  return Result.ok({ db, ...rowResult.value })
}

export async function listDocuments(context: DocumentToolContext) {
  const threadContext = await loadThreadContext(context)
  if (threadContext.isErr())
    return { ok: false, error: threadContext.error.message }
  const { db, workspaceId, ownerUserId } = threadContext.value
  const rowsResult = await Result.tryPromise({
    try: async () =>
      await db
        .select({
          id: schema.document.id,
          filename: schema.document.filename,
          fileType: schema.document.fileType,
          currentVersionId: schema.document.currentVersionId,
          createdAt: schema.document.createdAt,
        })
        .from(schema.document)
        .where(
          and(
            eq(schema.document.workspaceId, workspaceId),
            eq(schema.document.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(desc(schema.document.createdAt)),
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (rowsResult.isErr()) return { ok: false, error: rowsResult.error.message }
  return { ok: true, documents: rowsResult.value }
}

export async function generateDocx(args: {
  context: DocumentToolContext
  title: string
  sections: DocumentSection[]
  landscape?: boolean
  options?: GenerateDocxOptions
}) {
  if (!args.context.documentArtifacts) {
    return {
      ok: false,
      error: 'Editable document authority is not configured.',
    }
  }
  const threadContext = await loadThreadContext(args.context)
  if (threadContext.isErr())
    return { ok: false, error: threadContext.error.message }
  const { db, workspaceId, ownerUserId, threadId } = threadContext.value

  const FONT = args.options?.font?.trim() || DEFAULT_FONT
  const SIZE = 22
  type DocChild = InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  const children: DocChild[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: args.title.toUpperCase(),
          color: '000000',
          font: FONT,
          size: SIZE,
          bold: true,
        }),
      ],
    }),
  ]

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  }
  const headingLevels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ]
  const counters = [0, 0, 0, 0]

  for (const section of args.sections) {
    if (section.pageBreak) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    if (section.heading) {
      const idx = Math.min((section.level ?? 1) - 1, 3)
      counters[idx] = (counters[idx] ?? 0) + 1
      for (let i = idx + 1; i < 4; i++) counters[i] = 0
      const prefix = counters.slice(0, idx + 1).join('.')
      const headingText = `${prefix}. ${idx === 0 ? section.heading.toUpperCase() : section.heading}`
      const headingLevel = headingLevels[idx] ?? HeadingLevel.HEADING_1
      children.push(
        new Paragraph({
          heading: headingLevel,
          spacing: { after: 160 },
          children: [
            new TextRun({
              text: headingText,
              color: '000000',
              font: FONT,
              size: SIZE,
              bold: true,
            }),
          ],
        }),
      )
    }
    if (section.table) {
      const { headers, rows } = section.table
      const colCount = headers.length
      const tableRows: InstanceType<typeof TableRow>[] = [
        new TableRow({
          tableHeader: true,
          children: headers.map(
            (header) =>
              new TableCell({
                borders: cellBorder,
                shading: { fill: 'F2F2F2' },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: header,
                        bold: true,
                        font: FONT,
                        size: SIZE,
                      }),
                    ],
                    alignment: AlignmentType.LEFT,
                  }),
                ],
              }),
          ),
        }),
      ]
      for (const rawRow of rows) {
        const normalized = Array.from({ length: colCount }, (_, index) =>
          typeof rawRow[index] === 'string' ? rawRow[index] : '',
        )
        tableRows.push(
          new TableRow({
            children: normalized.map(
              (cell) =>
                new TableCell({
                  borders: cellBorder,
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: cell, font: FONT, size: SIZE }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
        )
      }
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
        }),
      )
      children.push(new Paragraph({ text: '' }))
    }
    if (section.content) {
      for (const line of section.content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const bulletMatch = trimmed.match(/^[-*]\s+(.+)/)
        const bodyText = bulletMatch ? bulletMatch[1] : trimmed
        const inlineRuns = parseInlineRuns(bodyText ?? '', {
          font: FONT,
          size: SIZE,
        })
        children.push(
          bulletMatch
            ? new Paragraph({
                bullet: { level: 0 },
                spacing: { after: 120 },
                children: inlineRuns,
              })
            : new Paragraph({
                spacing: { after: 120 },
                children: inlineRuns,
              }),
        )
      }
    }
  }

  const pageSize = args.options?.pageSize ?? 'letter'
  const dimensions = PAGE_DIMENSIONS_DXA[pageSize]
  const pageProperties = {
    page: {
      size: {
        width: dimensions.width,
        height: dimensions.height,
        ...(args.landscape ? { orientation: PageOrientation.LANDSCAPE } : {}),
      },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
  }

  const headerText = args.options?.header?.trim()
  const footerText = args.options?.footer?.trim()
  const showPageNumbers = args.options?.pageNumbers === true

  const sectionConfig: {
    properties: typeof pageProperties
    headers?: { default: InstanceType<typeof Header> }
    footers?: { default: InstanceType<typeof Footer> }
    children: typeof children
  } = { properties: pageProperties, children }

  if (headerText) {
    sectionConfig.headers = {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({ text: headerText, font: FONT, size: SIZE - 4 }),
            ],
          }),
        ],
      }),
    }
  }

  if (footerText || showPageNumbers) {
    const footerChildren: InstanceType<typeof TextRun>[] = []
    if (footerText) {
      footerChildren.push(
        new TextRun({ text: footerText, font: FONT, size: SIZE - 4 }),
      )
    }
    if (showPageNumbers) {
      if (footerText) {
        footerChildren.push(
          new TextRun({ text: '   ', font: FONT, size: SIZE - 4 }),
        )
      }
      footerChildren.push(
        new TextRun({
          children: ['Page ', PageNumber.CURRENT],
          font: FONT,
          size: SIZE - 4,
        }),
        new TextRun({
          children: [' of ', PageNumber.TOTAL_PAGES],
          font: FONT,
          size: SIZE - 4,
        }),
      )
    }
    sectionConfig.footers = {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: showPageNumbers
              ? AlignmentType.RIGHT
              : AlignmentType.LEFT,
            children: footerChildren,
          }),
        ],
      }),
    }
  }

  const doc = new Document({ sections: [sectionConfig] })
  const packResult = await Result.tryPromise({
    try: async () => await Packer.toBuffer(doc),
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (packResult.isErr()) return { ok: false, error: packResult.error.message }

  const documentId = crypto.randomUUID()
  const safeTitle =
    args.title
      .replace(/[^a-zA-Z0-9 -]/g, '')
      .trim()
      .slice(0, 64) || 'document'
  const filename = `${safeTitle}.docx`
  const workspacePath = `/documents/${documentId}/versions/v1/${filename}`
  const writeResult = await Result.tryPromise({
    try: async () =>
      await args.context.workspace.writeFileBytes(
        workspacePath,
        packResult.value,
        contentTypeForFileType('docx'),
      ),
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (writeResult.isErr())
    return { ok: false, error: writeResult.error.message }

  const generatedMetadata = await extractDocumentMetadata(
    Buffer.from(packResult.value),
    'docx',
  )

  const insertResult = await Result.tryPromise({
    try: async () => {
      const [docRow] = await db
        .insert(schema.document)
        .values({
          id: documentId,
          workspaceId,
          ownerUserId,
          threadId,
          filename,
          fileType: 'docx',
          sizeBytes: packResult.value.byteLength,
          pageCount: generatedMetadata.pageCount,
          structureTree: generatedMetadata.structureTree ?? null,
          status: 'ready',
        })
        .returning({ id: schema.document.id })
      if (!docRow) {
        throw new Error('Failed to record generated document.')
      }
      const [versionRow] = await db
        .insert(schema.documentVersion)
        .values({
          documentId: docRow.id,
          storagePath: workspacePath,
          source: 'generated',
          versionNumber: 1,
          displayName: filename,
        })
        .returning({ id: schema.documentVersion.id })
      if (!versionRow) {
        throw new Error('Failed to record generated document version.')
      }
      await db
        .update(schema.document)
        .set({ currentVersionId: versionRow.id, updatedAt: new Date() })
        .where(eq(schema.document.id, docRow.id))
      return { documentId: docRow.id, versionId: versionRow.id }
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (insertResult.isErr())
    return { ok: false, error: insertResult.error.message }

  const canonicalResult = await args.context.documentArtifacts.initializeDocx({
    bytes: packResult.value,
    documentId: insertResult.value.documentId,
    filename,
  })
  if (!canonicalResult.ok) {
    return {
      ok: false,
      error: documentArtifactErrorMessage(canonicalResult.error),
      document_id: insertResult.value.documentId,
      version_id: insertResult.value.versionId,
    }
  }

  return {
    ok: true,
    canonical_revision: canonicalResult.snapshot.revision,
    filename,
    document_id: insertResult.value.documentId,
    version_id: insertResult.value.versionId,
    version_number: 1,
    download_url: documentDownloadUrl(insertResult.value.documentId, filename),
    artifact: buildArtifact({
      documentId: insertResult.value.documentId,
      filename,
      fileType: 'docx',
      versionId: insertResult.value.versionId,
      versionNumber: 1,
    }),
  }
}

async function loadActiveDocument(
  context: DocumentToolContext,
  documentId: string,
) {
  const threadContext = await loadThreadContext(context)
  if (threadContext.isErr()) return threadContext
  const { db, threadId } = threadContext.value
  const rowResult = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          id: schema.document.id,
          filename: schema.document.filename,
          fileType: schema.document.fileType,
          ownerUserId: schema.document.ownerUserId,
          storagePath: schema.documentVersion.storagePath,
          versionId: schema.documentVersion.id,
          versionNumber: schema.documentVersion.versionNumber,
        })
        .from(schema.document)
        .innerJoin(
          schema.documentVersion,
          eq(schema.document.currentVersionId, schema.documentVersion.id),
        )
        .where(
          and(
            eq(schema.document.id, documentId),
            eq(schema.document.threadId, threadId),
          ),
        )
        .limit(1)
      return row ? { ...row, threadId } : null
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  return rowResult
}

/**
 * Reads the active document projection for Think. Images return typed metadata
 * instead of attempting text extraction; `documentReadModelOutput` then loads
 * the same authorized bytes into a private AI SDK image-data part.
 */
export async function readDocument(args: {
  context: DocumentToolContext
  documentId: string
}) {
  const rowResult = await loadActiveDocument(args.context, args.documentId)
  if (rowResult.isErr()) return { ok: false, error: rowResult.error.message }
  if (!rowResult.value) return { ok: false, error: 'Document not found.' }
  if (rowResult.value.fileType === 'docx') {
    if (!args.context.documentArtifacts) {
      return {
        ok: false,
        error: 'Editable document authority is not configured.',
      }
    }
    const canonicalResult = await args.context.documentArtifacts.read(
      args.documentId,
    )
    if (!canonicalResult.ok) {
      return {
        ok: false,
        error: documentArtifactErrorMessage(canonicalResult.error),
      }
    }
    const snapshot = canonicalResult.snapshot
    return {
      ok: true,
      document_id: rowResult.value.id,
      filename: rowResult.value.filename,
      version_id: null,
      version_number: null,
      source_version_id: rowResult.value.versionId,
      source_version_number: rowResult.value.versionNumber,
      kind: 'canonical_document' as const,
      media_type: contentTypeForFileType('docx'),
      canonical_revision: snapshot.revision,
      title: snapshot.title,
      blocks: snapshot.blocks,
      text: documentBlocksToText(snapshot.blocks),
    }
  }
  const bytesResult = await readWorkspaceBytes(
    args.context.workspace,
    rowResult.value.storagePath,
  )
  if (bytesResult.isErr())
    return { ok: false, error: bytesResult.error.message }
  const mediaType = contentTypeForFileType(
    rowResult.value.fileType,
    rowResult.value.filename,
  )
  if (mediaType.startsWith('image/')) {
    return {
      ok: true,
      document_id: rowResult.value.id,
      filename: rowResult.value.filename,
      version_id: rowResult.value.versionId,
      version_number: rowResult.value.versionNumber,
      kind: 'image' as const,
      media_type: mediaType,
      size_bytes: bytesResult.value.byteLength,
      text: null,
      note: `Read ${rowResult.value.filename} (${mediaType}, ${bytesResult.value.byteLength} bytes).`,
    }
  }
  const textResult = await extractDocumentText(
    bytesResult.value,
    rowResult.value.fileType,
  )
  if (textResult.isErr()) return { ok: false, error: textResult.error.message }
  return {
    ok: true,
    document_id: rowResult.value.id,
    filename: rowResult.value.filename,
    version_id: rowResult.value.versionId,
    version_number: rowResult.value.versionNumber,
    kind: 'text' as const,
    media_type: mediaType,
    size_bytes: bytesResult.value.byteLength,
    text: textResult.value,
  }
}

export type CitationAnnotation = {
  kind: 'citation'
  document_id: string
  filename: string
  quote: string
  canonical_revision?: number | null
  page?: number | null
  version_id?: string | null
  version_number?: number | null
  ref?: number | null
}

export async function findInDocument(args: {
  context: DocumentToolContext
  documentId: string
  query: string
  maxResults?: number
  contextChars?: number
}) {
  const readResult = await readDocument({
    context: args.context,
    documentId: args.documentId,
  })
  if (!readResult.ok || typeof readResult.text !== 'string') return readResult
  const text = readResult.text
  const { norm, origIdx } = normalizeWithMap(text)
  const needle = normalizeQuery(args.query)
  const maxResults = args.maxResults ?? 20
  const contextChars = args.contextChars ?? 80
  const hits: {
    index: number
    excerpt: string
    context: string
    page: number | null
  }[] = []
  let from = 0
  while (from <= norm.length - needle.length && hits.length < maxResults) {
    const pos = norm.indexOf(needle, from)
    if (pos < 0) break
    const endNormPos = pos + needle.length
    const origStart = origIdx[pos] ?? 0
    const origEnd =
      endNormPos - 1 < origIdx.length
        ? (origIdx[endNormPos - 1] ?? text.length - 1) + 1
        : text.length
    const ctxStart = Math.max(0, origStart - contextChars)
    const ctxEnd = Math.min(text.length, origEnd + contextChars)
    const page = inferPageNumberAt(text, origStart)
    hits.push({
      index: hits.length,
      excerpt: text.slice(origStart, origEnd),
      context:
        (ctxStart > 0 ? '...' : '') +
        text.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim() +
        (ctxEnd < text.length ? '...' : ''),
      page,
    })
    from = pos + Math.max(1, needle.length)
  }
  const annotations: CitationAnnotation[] = hits.map((hit, i) => ({
    kind: 'citation',
    document_id: readResult.document_id ?? args.documentId,
    filename: readResult.filename ?? 'document',
    quote: hit.context,
    canonical_revision:
      'canonical_revision' in readResult ? readResult.canonical_revision : null,
    page: hit.page,
    version_id: readResult.version_id ?? null,
    version_number: readResult.version_number ?? null,
    ref: i + 1,
  }))
  return {
    ok: true,
    filename: readResult.filename,
    document_id: readResult.document_id ?? args.documentId,
    version_id: readResult.version_id ?? null,
    version_number: readResult.version_number ?? null,
    query: args.query,
    returned: hits.length,
    hits,
    annotations,
  }
}

function inferPageNumberAt(text: string, position: number): number | null {
  // Our PDF text extractor inserts "[Page N]" markers between pages.
  // Walk back from `position` to the last marker so each hit gets a page
  // number when one is available.
  const slice = text.slice(0, position)
  const matches = slice.match(/\[Page (\d+)\]/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  if (!last) return null
  const page = Number(last.replace(/[^\d]/g, ''))
  return Number.isFinite(page) ? page : null
}

/**
 * Applies an agent command through the facet-owned Cloudflare Workspace Docs
 * authority. The former path rewrote OOXML and created review rows; canonical
 * block versions now produce explicit applied/conflict outcomes immediately.
 */
export async function editDocument(args: {
  context: DocumentToolContext
  documentId: string
  upserts: ReadonlyArray<DocumentBlockUpsert>
  deletes: ReadonlyArray<DocumentBlockDeletion>
  order: ReadonlyArray<string>
  title?: string
}) {
  const activeResult = await loadActiveDocument(args.context, args.documentId)
  if (activeResult.isErr())
    return { ok: false, error: activeResult.error.message }
  if (!activeResult.value) return { ok: false, error: 'Document not found.' }
  if (activeResult.value.fileType !== 'docx') {
    return {
      ok: false,
      error: 'Canonical document edits are only supported for .docx documents.',
    }
  }
  if (!args.context.documentArtifacts) {
    return {
      ok: false,
      error: 'Editable document authority is not configured.',
    }
  }
  const activeDocument = activeResult.value
  const currentResult = await args.context.documentArtifacts.read(
    args.documentId,
  )
  if (!currentResult.ok) {
    return {
      ok: false,
      error: documentArtifactErrorMessage(currentResult.error),
    }
  }

  const operation = DocumentOperation.make({
    operationId: crypto.randomUUID(),
    senderId: `agent:${args.context.threadId}`,
    baseRevision: currentResult.snapshot.revision,
    upserts: args.upserts,
    deletes: args.deletes,
    order: args.order,
    ...(args.title === undefined ? {} : { title: args.title }),
  })
  const applyResult = await args.context.documentArtifacts.apply(
    args.documentId,
    operation,
  )
  if (!applyResult.ok) {
    return {
      ok: false,
      error: documentArtifactErrorMessage(applyResult.error),
    }
  }

  return {
    ok: true,
    canonical_revision: applyResult.outcome.snapshot.revision,
    filename: activeDocument.filename,
    document_id: args.documentId,
    version_id: activeDocument.versionId,
    version_number: activeDocument.versionNumber,
    download_url: documentDownloadUrl(args.documentId, activeDocument.filename),
    outcome: applyResult.outcome,
    artifact: buildArtifact({
      documentId: args.documentId,
      filename: activeDocument.filename,
      fileType: 'docx',
      versionId: activeDocument.versionId,
      versionNumber: activeDocument.versionNumber,
    }),
  }
}

/**
 * Registers uploaded bytes as a first-class document and initial version.
 * Image uploads now preserve a caller media type or derive it from the cleaned
 * filename so storage metadata, artifact cards, and later model reads agree.
 */
export async function registerUploadedDocument(args: {
  context: DocumentToolContext
  filename: string
  mediaType?: string | null
  bytes: Uint8Array | ArrayBuffer
}) {
  const threadContext = await loadThreadContext(args.context)
  if (threadContext.isErr())
    return { ok: false, error: threadContext.error.message }
  const { db, workspaceId, ownerUserId, threadId } = threadContext.value
  const documentId = crypto.randomUUID()
  const filename = normalizeWorkspaceFilename(args.filename)
  const fileType = fileTypeFromFilename(filename, args.mediaType)
  const versionPath = `/documents/${documentId}/versions/v1/${filename}`
  const byteArray =
    args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes)
  const writeResult = await Result.tryPromise({
    try: async () =>
      await args.context.workspace.writeFileBytes(
        versionPath,
        byteArray,
        args.mediaType ?? contentTypeForFileType(fileType, filename),
      ),
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (writeResult.isErr())
    return { ok: false, error: writeResult.error.message }

  const metadata = await extractDocumentMetadata(
    Buffer.from(byteArray),
    fileType,
  )

  const insertResult = await Result.tryPromise({
    try: async () => {
      const [docRow] = await db
        .insert(schema.document)
        .values({
          id: documentId,
          workspaceId,
          ownerUserId,
          threadId,
          filename,
          fileType,
          sizeBytes: byteArray.byteLength,
          pageCount: metadata.pageCount,
          structureTree: metadata.structureTree ?? null,
          status: 'ready',
        })
        .returning({ id: schema.document.id })
      if (!docRow) throw new Error('Failed to record uploaded document.')
      const [versionRow] = await db
        .insert(schema.documentVersion)
        .values({
          documentId: docRow.id,
          storagePath: versionPath,
          source: 'upload',
          versionNumber: 1,
          displayName: filename,
        })
        .returning({ id: schema.documentVersion.id })
      if (!versionRow) {
        throw new Error('Failed to record uploaded document version.')
      }
      await db
        .update(schema.document)
        .set({ currentVersionId: versionRow.id, updatedAt: new Date() })
        .where(eq(schema.document.id, docRow.id))
      return { documentId: docRow.id, versionId: versionRow.id }
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (insertResult.isErr())
    return { ok: false, error: insertResult.error.message }

  return {
    ok: true,
    filename,
    document_id: insertResult.value.documentId,
    version_id: insertResult.value.versionId,
    version_number: 1,
    workspace_path: versionPath,
    download_url: documentDownloadUrl(insertResult.value.documentId, filename),
    artifact: buildArtifact({
      documentId: insertResult.value.documentId,
      filename,
      fileType,
      mediaType: args.mediaType ?? contentTypeForFileType(fileType, filename),
      versionId: insertResult.value.versionId,
      versionNumber: 1,
    }),
  }
}

export async function getDocumentBytes(args: {
  context: DocumentToolContext
  documentId: string
}) {
  return getDocumentVersionBytes({
    context: args.context,
    documentId: args.documentId,
  })
}

/**
 * Reads one authorized document projection without allowing a caller-supplied
 * version id to escape the requested document. Previously the join matched the
 * version id alone, so a known UUID from another document in the same thread
 * could select unrelated bytes; the join now enforces version ownership first.
 */
export async function getDocumentVersionBytes(args: {
  context: DocumentToolContext
  documentId: string
  preferPdf?: boolean
  versionId?: string | null
}) {
  const threadContext = await loadThreadContext(args.context)
  if (threadContext.isErr())
    return { ok: false, error: threadContext.error.message }
  const { db, threadId } = threadContext.value
  const versionResult = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          createdAt: schema.documentVersion.createdAt,
          displayName: schema.documentVersion.displayName,
          filename: schema.document.filename,
          fileType: schema.document.fileType,
          pdfStoragePath: schema.documentVersion.pdfStoragePath,
          source: schema.documentVersion.source,
          storagePath: schema.documentVersion.storagePath,
          versionId: schema.documentVersion.id,
          versionNumber: schema.documentVersion.versionNumber,
        })
        .from(schema.document)
        .innerJoin(
          schema.documentVersion,
          and(
            eq(schema.documentVersion.documentId, schema.document.id),
            args.versionId
              ? eq(schema.documentVersion.id, args.versionId)
              : eq(schema.document.currentVersionId, schema.documentVersion.id),
          ),
        )
        .where(
          and(
            eq(schema.document.id, args.documentId),
            eq(schema.document.threadId, threadId),
          ),
        )
        .limit(1)
      return row ?? null
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (versionResult.isErr())
    return { ok: false, error: versionResult.error.message }
  if (!versionResult.value) return { ok: false, error: 'Document not found.' }
  const version = versionResult.value
  const storagePath =
    args.preferPdf && version.pdfStoragePath
      ? version.pdfStoragePath
      : version.storagePath
  const bytesResult = await readWorkspaceBytes(
    args.context.workspace,
    storagePath,
  )
  if (bytesResult.isErr())
    return { ok: false, error: bytesResult.error.message }
  const fileType =
    args.preferPdf && version.pdfStoragePath ? 'pdf' : version.fileType
  return {
    ok: true,
    created_at: version.createdAt?.toISOString() ?? null,
    display_name: version.displayName,
    filename: version.filename,
    file_type: fileType,
    media_type: contentTypeForFileType(fileType, version.filename),
    source: version.source,
    version_id: version.versionId,
    version_number: version.versionNumber,
    bytes: bytesResult.value,
  }
}

export async function listDocumentVersions(args: {
  context: DocumentToolContext
  documentId: string
}) {
  const threadContext = await loadThreadContext(args.context)
  if (threadContext.isErr())
    return { ok: false, error: threadContext.error.message }
  const { db, threadId } = threadContext.value
  const result = await Result.tryPromise({
    try: async () => {
      const [documentRow] = await db
        .select({ currentVersionId: schema.document.currentVersionId })
        .from(schema.document)
        .where(
          and(
            eq(schema.document.id, args.documentId),
            eq(schema.document.threadId, threadId),
          ),
        )
        .limit(1)
      if (!documentRow) return null
      const rows = await db
        .select({
          createdAt: schema.documentVersion.createdAt,
          displayName: schema.documentVersion.displayName,
          id: schema.documentVersion.id,
          source: schema.documentVersion.source,
          versionNumber: schema.documentVersion.versionNumber,
        })
        .from(schema.documentVersion)
        .where(eq(schema.documentVersion.documentId, args.documentId))
        .orderBy(schema.documentVersion.versionNumber)
      return {
        currentVersionId: documentRow.currentVersionId,
        versions: rows,
      }
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (result.isErr()) return { ok: false, error: result.error.message }
  if (!result.value) return { ok: false, error: 'Document not found.' }
  return {
    ok: true,
    current_version_id: result.value.currentVersionId,
    versions: result.value.versions.map((row) => ({
      created_at: row.createdAt?.toISOString() ?? null,
      display_name: row.displayName,
      id: row.id,
      source: row.source,
      version_number: row.versionNumber,
    })),
  }
}

async function extractDocumentText(bytes: Buffer, fileType: string) {
  if (fileType === 'docx') {
    return Result.tryPromise({
      try: async () => {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer: bytes })
        return result.value
      },
      catch: (error) =>
        new DocumentToolError({
          message: error instanceof Error ? error.message : String(error),
        }),
    })
  }
  if (fileType === 'pdf') return extractPdfText(bytes)
  if (
    fileType === 'txt' ||
    fileType === 'md' ||
    fileType === 'json' ||
    fileType === 'csv'
  ) {
    return Result.ok(Buffer.from(bytes).toString('utf8'))
  }
  return Result.err(
    new DocumentToolError({
      message: `Unsupported document type: ${fileType}`,
    }),
  )
}

async function readWorkspaceBytes(workspace: WorkspaceFsLike, path: string) {
  return Result.tryPromise({
    try: async () => {
      const bytes = await workspace.readFileBytes(path)
      if (!bytes) throw new Error(`Document bytes not found: ${path}`)
      return Buffer.from(bytes)
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
}

function fileTypeFromFilename(filename: string, mediaType?: string | null) {
  const lower = filename.toLowerCase()
  if (mediaType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (
    mediaType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx'
  }
  if (mediaType === 'application/msword' || lower.endsWith('.doc')) return 'doc'
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md'
  if (mediaType === 'application/json' || lower.endsWith('.json')) return 'json'
  if (mediaType === 'text/csv' || lower.endsWith('.csv')) return 'csv'
  return 'unknown'
}

async function extractPdfText(bytes: Buffer) {
  return Result.tryPromise({
    try: async () => {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(bytes),
      }).promise
      const parts: string[] = []
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        parts.push(
          `[Page ${i}]\n${textContent.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')}`,
        )
      }
      return parts.join('\n\n')
    },
    catch: (error) =>
      new DocumentToolError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
}

export type StructureTreeNode = {
  id: string
  title: string
  level: number
  page_number: number | null
  children: StructureTreeNode[]
}

async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  const result = await Result.tryPromise(async () => {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    return pdf.numPages
  })
  return result.isOk() ? result.value : null
}

async function extractStructureTree(
  bytes: Buffer,
  fileType: string,
): Promise<StructureTreeNode[] | null> {
  const result = await Result.tryPromise(async () => {
    if (fileType === 'pdf') {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
        .promise
      if (pdf.numPages <= 5) return null
      const outline = (await pdf.getOutline()) as
        | { title?: string }[]
        | null
        | undefined
      if (outline?.length) {
        return outline.map<StructureTreeNode>((item, i) => ({
          id: `h1-${i}`,
          title: item.title ?? `Item ${i + 1}`,
          level: 1,
          page_number: null,
          children: [],
        }))
      }
      return Array.from(
        { length: pdf.numPages },
        (_, i): StructureTreeNode => ({
          id: `page-${i + 1}`,
          title: `Page ${i + 1}`,
          level: 1,
          page_number: i + 1,
          children: [],
        }),
      )
    }
    if (fileType === 'docx' || fileType === 'doc') {
      const mammoth = await import('mammoth')
      const extracted = await mammoth.extractRawText({ buffer: bytes })
      const lines = extracted.value.split('\n').filter((line) => line.trim())
      if (lines.length === 0) return null
      return lines.slice(0, 30).map<StructureTreeNode>((line, i) => ({
        id: `h1-${i}`,
        title: line.slice(0, 100),
        level: 1,
        page_number: null,
        children: [],
      }))
    }
    return null
  })
  return result.isOk() ? result.value : null
}

export async function extractDocumentMetadata(
  bytes: Buffer,
  fileType: string,
): Promise<{
  pageCount: number | null
  structureTree: StructureTreeNode[] | null
}> {
  const byteView = new Uint8Array(bytes)
  const [pageCount, structureTree] = await Promise.all([
    fileType === 'pdf' ? countPdfPages(byteView) : Promise.resolve(null),
    extractStructureTree(bytes, fileType),
  ])
  return { pageCount, structureTree }
}

function normalizeWithMap(text: string): { norm: string; origIdx: number[] } {
  const norm: string[] = []
  const origIdx: number[] = []
  let prevSpace = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ''
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(' ')
        origIdx.push(i)
        prevSpace = true
      }
    } else {
      norm.push(ch.toLowerCase())
      origIdx.push(i)
      prevSpace = false
    }
  }
  return { norm: norm.join(''), origIdx }
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}
