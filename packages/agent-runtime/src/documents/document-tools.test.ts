import type { WorkspaceFsLike } from '@cloudflare/shell'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPooledDb: vi.fn() }))

vi.mock('@garden/db/runtime', () => ({ getPooledDb: mocks.getPooledDb }))

import {
  getDocumentVersionBytes,
  readDocument,
  registerUploadedDocument,
  type DocumentToolContext,
} from './document-tools'

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
