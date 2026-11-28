import type { WorkspaceFsLike } from '@cloudflare/shell'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPooledDb: vi.fn() }))

vi.mock('@garden/db/runtime', () => ({ getPooledDb: mocks.getPooledDb }))

import {
  XML_PARSE_BUDGET_MS,
  pathologicalWordDocuments,
  storedDocx,
} from '../../fixtures/word-xml'
import {
  editDocument,
  extractDocumentMetadata,
  findInDocument,
  generateDocx,
  getDocumentVersionBytes,
  readDocument,
  registerUploadedDocument,
  type DocumentArtifactToolAuthority,
  type DocumentToolContext,
} from './document-tools'
import {
  DocumentOperationOutcome,
  type DocumentSnapshot,
} from './document-artifact-model'

// Builds and parses real DOCX files through dynamically imported libraries;
// the first import is slow on a loaded runner, past vitest's 5s default.
const DOCX_TEST_TIMEOUT_MS = 30_000

type QueryChain = {
  from: (...args: unknown[]) => QueryChain
  innerJoin: (...args: unknown[]) => QueryChain
  where: (...args: unknown[]) => QueryChain
  limit: (...args: unknown[]) => Promise<unknown[]>
}

/** Creates the narrow Drizzle query surface used by document read paths. */
function queryDatabase(...rows: unknown[][]) {
  const pending = [...rows]
  const query = {} as QueryChain
  query.from = () => query
  query.innerJoin = () => query
  query.where = () => query
  query.limit = async () => pending.shift() ?? []
  return { select: () => query }
}

/** Creates the read-only workspace surface required by document tools. */
function workspaceReading(bytes: Uint8Array) {
  return {
    readFileBytes: vi.fn(async () => bytes),
  } as unknown as WorkspaceFsLike
}

const canonicalSnapshot: DocumentSnapshot = {
  revision: 2,
  title: 'Editable brief',
  blocks: [
    {
      id: 'block-1',
      html: '<p data-block-id="block-1">Current canonical text</p>',
      version: 3,
    },
  ],
  lastModified: 1,
}

/** Creates the facet capability without exposing repository/storage details. */
function documentAuthority(
  overrides: Partial<DocumentArtifactToolAuthority> = {},
): DocumentArtifactToolAuthority {
  return {
    read: vi.fn(async () => ({
      ok: true as const,
      snapshot: canonicalSnapshot,
    })),
    apply: vi.fn(async () => ({
      ok: true as const,
      outcome: DocumentOperationOutcome.cases.Unchanged.make({
        snapshot: canonicalSnapshot,
      }),
    })),
    initializeDocx: vi.fn(async () => ({
      ok: true as const,
      snapshot: canonicalSnapshot,
    })),
    ...overrides,
  }
}

beforeEach(() => {
  mocks.getPooledDb.mockReset()
})

describe('spreadsheet document reads', () => {
  it('extracts visible XLSX sheets as tab-separated text', async () => {
    const workbook = new ExcelJS.Workbook()
    const revenue = workbook.addWorksheet('Revenue')
    revenue.addRow(['Month', 'Revenue'])
    revenue.addRow(['Jan', 100])
    const hidden = workbook.addWorksheet('Hidden')
    hidden.state = 'hidden'
    hidden.addRow(['secret'])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    mocks.getPooledDb.mockReturnValue(
      queryDatabase(
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [
          {
            id: 'document-1',
            filename: 'Revenue.xlsx',
            fileType: 'xlsx',
            ownerUserId: 'user-1',
            storagePath: '/documents/revenue.xlsx',
            versionId: 'version-1',
            versionNumber: 1,
          },
        ],
      ),
    )

    const result = await readDocument({
      context: {
        databaseUrl: 'postgres://test',
        documentArtifacts: documentAuthority(),
        workspace: workspaceReading(bytes),
        threadId: 'thread-1',
      },
      documentId: 'document-1',
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'text',
      media_type:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      text: '## Revenue\nMonth\tRevenue\nJan\t100',
    })
    if (result.ok) expect(result.text).not.toContain('secret')
  })
})

describe('document image media types', () => {
  it('returns image metadata without attempting text extraction', async () => {
    mocks.getPooledDb.mockReturnValue(
      queryDatabase(
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [
          {
            id: 'document-1',
            filename: 'Evidence.PNG',
            fileType: 'unknown',
            ownerUserId: 'user-1',
            storagePath: '/documents/evidence.png',
            versionId: 'version-1',
            versionNumber: 1,
          },
        ],
      ),
    )
    const bytes = new Uint8Array([137, 80, 78, 71])

    const result = await readDocument({
      context: {
        databaseUrl: 'postgres://test',
        documentArtifacts: documentAuthority(),
        workspace: workspaceReading(bytes),
        threadId: 'thread-1',
      },
      documentId: 'document-1',
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'image',
      media_type: 'image/png',
      size_bytes: 4,
      text: null,
    })
  })

  it('uses filename-derived image MIME for storage and artifacts', async () => {
    const queryDb = queryDatabase([
      {
        threadId: 'thread-1',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
      },
    ])
    let insertIndex = 0
    const database = {
      ...queryDb,
      insert: () => {
        const result =
          insertIndex++ === 0 ? [{ id: 'document-1' }] : [{ id: 'version-1' }]
        return {
          values: () => ({ returning: async () => result }),
        }
      },
      update: () => ({
        set: () => ({ where: async () => undefined }),
      }),
    }
    mocks.getPooledDb.mockReturnValue(database)
    const writeFileBytes = vi.fn(async () => undefined)
    const context: DocumentToolContext = {
      databaseUrl: 'postgres://test',
      documentArtifacts: documentAuthority(),
      workspace: { writeFileBytes } as unknown as WorkspaceFsLike,
      threadId: 'thread-1',
    }

    const result = await registerUploadedDocument({
      context,
      filename: 'Screenshot.WEBP',
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result).toMatchObject({
      ok: true,
      artifact: { mediaType: 'image/webp' },
    })
    expect(writeFileBytes).toHaveBeenCalledWith(
      expect.stringContaining('/Screenshot.WEBP'),
      expect.any(Uint8Array),
      'image/webp',
    )
  })

  it('keeps preferred PDF projections typed as PDF', async () => {
    mocks.getPooledDb.mockReturnValue(
      queryDatabase(
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [
          {
            createdAt: null,
            displayName: 'Evidence PDF',
            filename: 'Evidence.PNG',
            fileType: 'unknown',
            pdfStoragePath: '/documents/evidence.pdf',
            source: 'conversion',
            storagePath: '/documents/evidence.png',
            versionId: 'version-1',
            versionNumber: 1,
          },
        ],
      ),
    )

    const result = await getDocumentVersionBytes({
      context: {
        databaseUrl: 'postgres://test',
        documentArtifacts: documentAuthority(),
        workspace: workspaceReading(new Uint8Array([37, 80, 68, 70])),
        threadId: 'thread-1',
      },
      documentId: 'document-1',
      preferPdf: true,
    })

    expect(result).toMatchObject({
      ok: true,
      file_type: 'pdf',
      media_type: 'application/pdf',
    })
  })
})

describe('canonical DOCX document tools', () => {
  it('reads and searches current authority blocks without opening source bytes', async () => {
    mocks.getPooledDb.mockReturnValue(
      queryDatabase(
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [
          {
            id: 'document-1',
            filename: 'Brief.docx',
            fileType: 'docx',
            ownerUserId: 'user-1',
            storagePath: '/documents/source.docx',
            versionId: 'version-1',
            versionNumber: 1,
          },
        ],
      ),
    )
    const workspace = workspaceReading(new Uint8Array([1, 2, 3]))
    const context: DocumentToolContext = {
      databaseUrl: 'postgres://test',
      documentArtifacts: documentAuthority(),
      workspace,
      threadId: 'thread-1',
    }

    const read = await readDocument({ context, documentId: 'document-1' })

    expect(read).toMatchObject({
      ok: true,
      kind: 'canonical_document',
      canonical_revision: 2,
      text: 'Current canonical text',
      version_id: null,
    })
    expect(workspace.readFileBytes).not.toHaveBeenCalled()

    mocks.getPooledDb.mockReturnValue(
      queryDatabase(
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [
          {
            id: 'document-1',
            filename: 'Brief.docx',
            fileType: 'docx',
            ownerUserId: 'user-1',
            storagePath: '/documents/source.docx',
            versionId: 'version-1',
            versionNumber: 1,
          },
        ],
      ),
    )
    const found = await findInDocument({
      context,
      documentId: 'document-1',
      query: 'canonical text',
    })
    expect(found).toMatchObject({
      ok: true,
      returned: 1,
      annotations: [{ canonical_revision: 2, version_id: null }],
    })
  })

  it('returns the authority conflict and never rewrites source DOCX bytes', async () => {
    mocks.getPooledDb.mockReturnValue(
      queryDatabase(
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [
          {
            id: 'document-1',
            filename: 'Brief.docx',
            fileType: 'docx',
            ownerUserId: 'user-1',
            storagePath: '/documents/source.docx',
            versionId: 'version-1',
            versionNumber: 1,
          },
        ],
      ),
    )
    const conflict = DocumentOperationOutcome.cases.Conflict.make({
      snapshot: { ...canonicalSnapshot, revision: 3 },
      committed: false,
      accepted: [],
      deletedIds: [],
      conflicts: canonicalSnapshot.blocks,
    })
    const apply = vi.fn(async () => ({ ok: true as const, outcome: conflict }))
    const workspace = {
      readFileBytes: vi.fn(),
      writeFileBytes: vi.fn(),
    } as unknown as WorkspaceFsLike
    const context: DocumentToolContext = {
      databaseUrl: 'postgres://test',
      documentArtifacts: documentAuthority({ apply }),
      workspace,
      threadId: 'thread-1',
    }

    const result = await editDocument({
      context,
      documentId: 'document-1',
      upserts: [
        {
          id: 'block-1',
          html: '<p data-block-id="block-1">Agent draft</p>',
          baseVersion: 2,
        },
      ],
      deletes: [],
      order: ['block-1'],
    })

    expect(result).toMatchObject({
      ok: true,
      canonical_revision: 3,
      outcome: { _tag: 'Conflict', committed: false },
    })
    expect(apply).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({
        operationId: expect.any(String),
        senderId: 'agent:thread-1',
        baseRevision: 2,
        upserts: [expect.objectContaining({ baseVersion: 2 })],
      }),
    )
    expect(workspace.readFileBytes).not.toHaveBeenCalled()
    expect(workspace.writeFileBytes).not.toHaveBeenCalled()
  })

  it(
    'initializes generated DOCX bytes through the canonical authority',
    async () => {
      const queryDb = queryDatabase([
        {
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          ownerUserId: 'user-1',
        },
      ])
      let insertIndex = 0
      mocks.getPooledDb.mockReturnValue({
        ...queryDb,
        insert: () => {
          const rows =
            insertIndex++ === 0 ? [{ id: 'document-1' }] : [{ id: 'version-1' }]
          return { values: () => ({ returning: async () => rows }) }
        },
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      })
      const initializeDocx = vi.fn(async () => ({
        ok: true as const,
        snapshot: canonicalSnapshot,
      }))
      const context: DocumentToolContext = {
        databaseUrl: 'postgres://test',
        documentArtifacts: documentAuthority({ initializeDocx }),
        workspace: {
          writeFileBytes: vi.fn(async () => undefined),
        } as unknown as WorkspaceFsLike,
        threadId: 'thread-1',
      }

      const result = await generateDocx({
        context,
        title: 'Generated brief',
        sections: [{ heading: 'Summary', content: 'Canonical content' }],
      })

      expect(result).toMatchObject({
        ok: true,
        canonical_revision: 2,
        document_id: 'document-1',
      })
      expect(initializeDocx).toHaveBeenCalledWith({
        bytes: expect.any(Uint8Array),
        documentId: 'document-1',
        filename: 'Generated brief.docx',
      })
    },
    DOCX_TEST_TIMEOUT_MS,
  )
})

describe('document read failures', () => {
  it('keeps the Postgres cause and code that drizzle wraps', async () => {
    const pgError = Object.assign(
      new Error('relation "chat_thread" does not exist'),
      { code: '42P01' },
    )
    const query = {} as QueryChain
    query.from = () => query
    query.innerJoin = () => query
    query.where = () => query
    query.limit = async () => {
      throw new Error('Failed query: select "id" from "chat_thread"', {
        cause: pgError,
      })
    }
    mocks.getPooledDb.mockReturnValue({ select: () => query })

    const result = await readDocument({
      context: {
        databaseUrl: 'postgres://test',
        documentArtifacts: documentAuthority(),
        workspace: workspaceReading(new Uint8Array()),
        threadId: 'thread-1',
      },
      documentId: 'document-1',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Failed query')
    expect(result.error).toContain('relation "chat_thread" does not exist')
    expect(result.error).toContain('42P01')
  })
})

/** Builds a minimal valid PDF with one Helvetica text line per page. */
function pdfWithPages(pages: string[]) {
  const pageIds = pages.map((_, i) => 3 + i * 2)
  const fontId = 3 + pages.length * 2
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...pages.flatMap((text, i) => {
      const stream = text ? `BT /F1 18 Tf 72 720 Td (${text}) Tj ET` : ''
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ]
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

/** Reads one uploaded document of the given type through `readDocument`. */
async function readUploaded(file: {
  filename: string
  fileType: string
  bytes: Uint8Array
}) {
  mocks.getPooledDb.mockReturnValue(
    queryDatabase(
      [
        {
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          ownerUserId: 'user-1',
        },
      ],
      [
        {
          id: 'document-1',
          filename: file.filename,
          fileType: file.fileType,
          ownerUserId: 'user-1',
          storagePath: `/documents/${file.filename}`,
          versionId: 'version-1',
          versionNumber: 1,
        },
      ],
    ),
  )
  return readDocument({
    context: {
      databaseUrl: 'postgres://test',
      documentArtifacts: documentAuthority(),
      workspace: workspaceReading(file.bytes),
      threadId: 'thread-1',
    },
    documentId: 'document-1',
  })
}

describe('PDF document reads', () => {
  it('extracts text per page with page markers', async () => {
    const result = await readUploaded({
      filename: 'Report.pdf',
      fileType: 'pdf',
      bytes: pdfWithPages(['Quarterly revenue grew', 'Hiring plan']),
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'text',
      media_type: 'application/pdf',
      text: '[Page 1]\nQuarterly revenue grew\n\n[Page 2]\nHiring plan',
    })
  })

  it('reports a PDF without a text layer as unreadable text, with recovery steps', async () => {
    const result = await readUploaded({
      filename: 'Scan.pdf',
      fileType: 'pdf',
      bytes: pdfWithPages(['']),
    })

    expect(result).toMatchObject({ ok: false, reason: 'no_text' })
    expect(result.error).toContain('Scan.pdf has no extractable text')
    expect(result.error).toContain('paste the relevant text')
  })

  it('replaces parser errors for a damaged PDF with recovery steps', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await readUploaded({
      filename: 'Broken.pdf',
      fileType: 'pdf',
      bytes: new TextEncoder().encode('%PDF-1.4 not really a pdf'),
    })

    expect(result).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(result.error).toMatch(
      /^Broken\.pdf could not be parsed\..*upload a text-based copy/,
    )
    expect(warn).toHaveBeenCalledWith(
      '[documents] text extraction failed',
      expect.objectContaining({ reason: 'unreadable', fileType: 'pdf' }),
    )
    warn.mockRestore()
  })

  it('explains unsupported formats instead of failing silently', async () => {
    const result = await readUploaded({
      filename: 'Legacy.doc',
      fileType: 'doc',
      bytes: new Uint8Array([0xd0, 0xcf]),
    })

    expect(result).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(result.error).toContain('Legacy.doc is a doc file')
  })
})

describe('extractDocumentMetadata', () => {
  // Uploads build a DOCX outline with Mammoth before any editable import.
  it.each(pathologicalWordDocuments)(
    'builds no DOCX outline for word XML with %s within the parse budget',
    async (_label, documentXml) => {
      const bytes = Buffer.from(storedDocx(documentXml))
      // Load Mammoth first so the budget measures parsing, not module loading.
      await import('mammoth')
      const started = performance.now()
      const metadata = await extractDocumentMetadata(bytes, 'docx')
      const elapsed = performance.now() - started

      expect(metadata).toEqual({ pageCount: null, structureTree: null })
      expect(elapsed).toBeLessThan(XML_PARSE_BUDGET_MS)
    },
    // An unpatched parser takes up to 25 seconds on these inputs.
    60_000,
  )
})
