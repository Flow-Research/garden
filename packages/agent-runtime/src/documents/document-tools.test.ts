import type { WorkspaceFsLike } from '@cloudflare/shell'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPooledDb: vi.fn() }))

vi.mock('@garden/db/runtime', () => ({ getPooledDb: mocks.getPooledDb }))

import {
  editDocument,
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

  it('initializes generated DOCX bytes through the canonical authority', async () => {
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
  })
})
