import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DateTime, Effect, Layer } from 'effect'
import { ItemId, Kind, WorkspaceId, type BrainItem } from '@garden/brain/domain'
import type { AppRequestContext } from '@/lib/server/context'
import { getBrainFolders, postBrainFolder } from '@/routes/api/brain/folders'
import {
  deleteBrainFolderHandler,
  getBrainFolderDetail,
  patchBrainFolder,
} from '@/routes/api/brain/folders/$id'
import {
  deleteBrainFolderFile,
  postBrainFolderFile,
} from '@/routes/api/brain/folders/$id/files'

/**
 * Route tests for the Files & Folders folder API. Postgres is replaced with
 * an in-memory folder store (`@/lib/server/brain-folders` mock) and Helix with
 * an in-memory Brain service so every assertion runs through the real route
 * handlers and Zod contracts.
 */

const mockRequireAppRequestContext = vi.hoisted(() => vi.fn())
const mockRequireWorkspaceContext = vi.hoisted(() => vi.fn())

type FolderRow = {
  id: string
  workspaceId: string
  name: string
  privacy: 'private' | 'shared'
  createdBy: string
  createdAt: Date
}

const folderRows = vi.hoisted(() => new Map<string, FolderRow>())
const folderFiles = vi.hoisted(() => new Map<string, Set<string>>())
const mockBrainItems = vi.hoisted(() => new Map<string, BrainItem>())

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: mockRequireAppRequestContext,
}))

vi.mock('@/lib/server/control-plane', () => ({
  badRequest: (message: string) =>
    Response.json({ error: message }, { status: 400 }),
  notFound: (message: string) =>
    Response.json({ error: message }, { status: 404 }),
  requireWorkspaceContext: mockRequireWorkspaceContext,
}))

vi.mock('@/lib/server/brain-folders', () => {
  const toRow = (row: FolderRow) => ({
    id: row.id,
    name: row.name,
    privacy: row.privacy,
    fileCount: folderFiles.get(row.id)?.size ?? 0,
    createdByName: 'Fred',
    createdByEmail: 'fred@garden.test',
    createdAt: row.createdAt,
  })
  const findRow = (workspaceId: string, folderId: string) => {
    const row = folderRows.get(folderId)
    return row !== undefined && row.workspaceId === workspaceId ? row : null
  }
  // Mirrors the real module's contract: 'shared' folders are visible to every
  // workspace member; 'private' folders only to their creator.
  const visibleTo = (row: FolderRow, userId: string) =>
    row.privacy === 'shared' || row.createdBy === userId
  const findVisibleRow = (
    workspaceId: string,
    userId: string,
    folderId: string,
  ) => {
    const row = findRow(workspaceId, folderId)
    return row !== null && visibleTo(row, userId) ? row : null
  }
  return {
    brainFolderSummaryOf: (row: ReturnType<typeof toRow>) => ({
      id: row.id,
      name: row.name,
      privacy: row.privacy,
      fileCount: row.fileCount,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
    }),
    listBrainFolders: async ({
      workspaceId,
      userId,
    }: {
      workspaceId: string
      userId: string
    }) =>
      [...folderRows.values()]
        .filter(
          (row) => row.workspaceId === workspaceId && visibleTo(row, userId),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toRow),
    getBrainFolder: async ({
      workspaceId,
      userId,
      folderId,
    }: {
      workspaceId: string
      userId: string
      folderId: string
    }) => {
      const row = findVisibleRow(workspaceId, userId, folderId)
      return row === null ? null : toRow(row)
    },
    createBrainFolder: async (input: {
      workspaceId: string
      userId: string
      name: string
      privacy: 'private' | 'shared'
    }) => {
      const id = `folder-${folderRows.size + 1}`
      folderRows.set(id, {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        privacy: input.privacy,
        createdBy: input.userId,
        createdAt: new Date(Date.now() + folderRows.size),
      })
      folderFiles.set(id, new Set())
      return { id }
    },
    updateBrainFolder: async (input: {
      workspaceId: string
      userId: string
      folderId: string
      name?: string
      privacy?: 'private' | 'shared'
    }) => {
      const row = findVisibleRow(
        input.workspaceId,
        input.userId,
        input.folderId,
      )
      if (row === null) return false
      if (input.name !== undefined) row.name = input.name
      if (input.privacy !== undefined) row.privacy = input.privacy
      return true
    },
    deleteBrainFolder: async (input: {
      workspaceId: string
      userId: string
      folderId: string
    }) => {
      const row = findVisibleRow(
        input.workspaceId,
        input.userId,
        input.folderId,
      )
      if (row === null) return false
      folderRows.delete(row.id)
      folderFiles.delete(row.id)
      return true
    },
    listBrainFolderFileIds: async ({
      workspaceId,
      folderId,
    }: {
      workspaceId: string
      folderId: string
    }) =>
      findRow(workspaceId, folderId) === null
        ? []
        : [...(folderFiles.get(folderId) ?? [])],
    addBrainFolderFile: async (input: {
      workspaceId: string
      folderId: string
      fileId: string
    }) => {
      if (findRow(input.workspaceId, input.folderId) === null) return false
      const members = folderFiles.get(input.folderId) ?? new Set<string>()
      if (members.has(input.fileId)) return false
      members.add(input.fileId)
      folderFiles.set(input.folderId, members)
      return true
    },
    removeBrainFolderFile: async (input: {
      workspaceId: string
      folderId: string
      fileId: string
    }) => {
      const members = folderFiles.get(input.folderId)
      if (members === undefined || !members.delete(input.fileId)) return false
      return true
    },
  }
})

vi.mock('@/lib/server/brain-file-summary', () => ({
  brainFileSummaryOf: (item: BrainItem) => ({
    id: item.id,
    name: item.label,
    status: item.indexStatus ?? (item.indexed ? 'ready' : 'processing'),
    uploadedAt: DateTime.toDate(item.origin.at).toISOString(),
    ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
  }),
  loadBrainFileOwnerNames: async () => new Map<string, string>(),
  // Mirrors the real helper's contract: id-based resolution, tenant-scoped,
  // deleted/foreign items drop out.
  loadBrainItemsByIds: async ({
    workspaceId,
    fileIds,
  }: {
    workspaceId: string
    fileIds: readonly string[]
  }) => ({
    status: 'ok' as const,
    items: fileIds
      .map((id) => mockBrainItems.get(ItemId.make(id)))
      .filter(
        (item): item is BrainItem =>
          item !== undefined &&
          item.tenantId === workspaceId &&
          item.kind === 'file',
      ),
  }),
}))

vi.mock('@garden/brain/services/web', async () => {
  const { Brain: BrainService } = await vi.importActual<
    typeof import('@garden/brain/services/brain')
  >('@garden/brain/services/brain')

  return {
    makeWebBrainLive: () =>
      Layer.succeed(
        BrainService,
        BrainService.of({
          ensureIndexes: () => Effect.void,
          addItem: () => Effect.die('unused addItem'),
          addText: () => Effect.die('unused addText'),
          updateIndexStatus: () => Effect.die('unused updateIndexStatus'),
          deleteFile: () => Effect.die('unused deleteFile'),
          updateItemMetadata: () => Effect.die('unused updateItemMetadata'),
          index: () => Effect.die('unused index'),
          read: () => Effect.die('unused read'),
          readFileItem: (id, tenantId) => {
            const item = mockBrainItems.get(id)
            return Effect.succeed(
              item !== undefined &&
                item.tenantId === tenantId &&
                item.kind === 'file'
                ? item
                : null,
            )
          },
          search: () => Effect.die('unused search'),
          listFiles: ({ tenantId, limit = 100 }) =>
            Effect.succeed(
              [...mockBrainItems.values()]
                .filter((item) => item.tenantId === tenantId)
                .slice(0, limit),
            ),
          linkSections: () => Effect.die('unused linkSections'),
          sectionsOf: () => Effect.die('unused sectionsOf'),
          observeMention: () => Effect.die('unused observeMention'),
          linkItems: () => Effect.die('unused linkItems'),
          neighborhood: () => Effect.die('unused neighborhood'),
          readFile: () => Effect.die('unused readFile'),
        }),
      ),
  }
})

function storeBrainFile({
  itemId,
  workspaceId = 'ws-one',
  label = 'notes.txt',
  sizeBytes,
}: {
  itemId: string
  workspaceId?: string
  label?: string
  sizeBytes?: number
}) {
  const item: BrainItem = {
    id: ItemId.make(itemId),
    tenantId: WorkspaceId.make(workspaceId),
    kind: Kind.make('file'),
    label,
    indexed: true,
    indexStatus: 'ready',
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    origin: {
      actor: { _tag: 'Human', userId: 'user-route' },
      at: DateTime.makeUnsafe(new Date()),
    },
  }
  mockBrainItems.set(item.id, item)
  return item
}

function setupRequest(workspaceId = 'ws-one', userId = 'user-route') {
  mockRequireAppRequestContext.mockReturnValueOnce({
    env: {
      HYPERDRIVE: {},
      HELIX_URL: 'http://localhost:6968',
      HELIX_API_KEY: '',
      AI: {},
      BRAIN_FILES: {},
    },
    auth: {},
    waitUntil: () => {},
  } as unknown as AppRequestContext)
  mockRequireWorkspaceContext.mockResolvedValueOnce({
    session: { user: { id: userId } },
    workspaceId,
  })
}

const ctx = {} as AppRequestContext
const foldersUrl = 'https://garden.test/api/brain/folders'

beforeEach(() => {
  vi.clearAllMocks()
  folderRows.clear()
  folderFiles.clear()
  mockBrainItems.clear()
})

describe('POST /api/brain/folders', () => {
  it('creates a folder with name and privacy', async () => {
    setupRequest()

    const response = await postBrainFolder({
      context: ctx,
      request: new Request(foldersUrl, {
        method: 'POST',
        body: JSON.stringify({ name: '  Test Case  ', privacy: 'private' }),
      }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      item: Record<string, unknown>
    }
    expect(body.item).toEqual({
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private',
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: expect.any(String),
    })
  })

  it('rejects names longer than 50 characters', async () => {
    setupRequest()

    const response = await postBrainFolder({
      context: ctx,
      request: new Request(foldersUrl, {
        method: 'POST',
        body: JSON.stringify({ name: 'x'.repeat(51), privacy: 'shared' }),
      }),
    })

    expect(response.status).toBe(400)
    expect(folderRows.size).toBe(0)
  })

  it('rejects a malformed JSON body with 400, not 500', async () => {
    setupRequest()

    const response = await postBrainFolder({
      context: ctx,
      request: new Request(foldersUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    })

    expect(response.status).toBe(400)
    expect(folderRows.size).toBe(0)
  })

  it('rejects an empty name', async () => {
    setupRequest()

    const response = await postBrainFolder({
      context: ctx,
      request: new Request(foldersUrl, {
        method: 'POST',
        body: JSON.stringify({ name: '   ', privacy: 'shared' }),
      }),
    })

    expect(response.status).toBe(400)
  })
})

describe('GET /api/brain/folders', () => {
  it('lists only the active workspace folders, newest first', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-a', {
      id: 'folder-a',
      workspaceId: 'ws-one',
      name: 'Older',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date('2026-01-01'),
    })
    folderRows.set('folder-b', {
      id: 'folder-b',
      workspaceId: 'ws-one',
      name: 'Newer',
      privacy: 'shared',
      createdBy: 'user-route',
      createdAt: new Date('2026-02-01'),
    })
    folderRows.set('folder-foreign', {
      id: 'folder-foreign',
      workspaceId: 'ws-two',
      name: 'Foreign',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date('2026-03-01'),
    })

    const response = await getBrainFolders({ context: ctx })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = (await response.json()) as { items: { name: string }[] }
    expect(body.items.map((item) => item.name)).toEqual(['Newer', 'Older'])
  })
})

describe('GET /api/brain/folders/$id', () => {
  it('returns the folder with only its live member files', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set(['item-a', 'item-deleted']))
    storeBrainFile({ itemId: 'item-a', label: 'dots.pdf', sizeBytes: 11264 })
    storeBrainFile({ itemId: 'item-b', label: 'not-in-folder.txt' })

    const response = await getBrainFolderDetail({
      context: ctx,
      params: { id: 'folder-1' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      item: { fileCount: number }
      files: { name: string; sizeBytes?: number }[]
    }
    expect(body.item.fileCount).toBe(1)
    expect(body.files).toEqual([
      expect.objectContaining({ name: 'dots.pdf', sizeBytes: 11264 }),
    ])
  })

  it('keeps members whose labels sort beyond the 100-file list cap', async () => {
    // Regression: membership was resolved by filtering the 100-capped
    // listFiles; resolution is by id now, so list size is irrelevant.
    setupRequest()
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set(['item-member']))
    for (let i = 0; i < 100; i += 1) {
      storeBrainFile({
        itemId: `item-filler-${i}`,
        label: `a-${String(i).padStart(3, '0')}.txt`,
      })
    }
    storeBrainFile({ itemId: 'item-member', label: 'zzz-member.pdf' })

    const response = await getBrainFolderDetail({
      context: ctx,
      params: { id: 'folder-1' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      item: { fileCount: number }
      files: { name: string }[]
    }
    expect(body.item.fileCount).toBe(1)
    expect(body.files).toEqual([
      expect.objectContaining({ name: 'zzz-member.pdf' }),
    ])
  })

  it('returns 404 for a folder from another workspace', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-two',
      name: 'Foreign',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })

    const response = await getBrainFolderDetail({
      context: ctx,
      params: { id: 'folder-1' },
    })

    expect(response.status).toBe(404)
  })
})

describe('PATCH /api/brain/folders/$id', () => {
  it('renames a folder and flips privacy', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })

    const response = await patchBrainFolder({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed', privacy: 'shared' }),
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      item: { name: string; privacy: string }
    }
    expect(body.item.name).toBe('Renamed')
    expect(body.item.privacy).toBe('shared')
  })

  it('rejects an update with no fields', async () => {
    setupRequest('ws-one')

    const response = await patchBrainFolder({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
    })

    expect(response.status).toBe(400)
  })
})

describe('DELETE /api/brain/folders/$id', () => {
  it('deletes a folder and its memberships', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set(['item-a']))

    const response = await deleteBrainFolderHandler({
      context: ctx,
      params: { id: 'folder-1' },
    })

    expect(response.status).toBe(204)
    expect(folderRows.has('folder-1')).toBe(false)
    expect(folderFiles.has('folder-1')).toBe(false)
  })

  it('returns 404 for an unknown folder', async () => {
    setupRequest('ws-one')

    const response = await deleteBrainFolderHandler({
      context: ctx,
      params: { id: 'folder-missing' },
    })

    expect(response.status).toBe(404)
  })
})

describe('POST /api/brain/folders/$id/files', () => {
  it('adds a workspace file to the folder', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set())
    storeBrainFile({ itemId: 'item-a' })

    const response = await postBrainFolderFile({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1/files`, {
        method: 'POST',
        body: JSON.stringify({ fileId: 'item-a' }),
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      item: { fileCount: number }
      files: { id: string }[]
    }
    expect(body.item.fileCount).toBe(1)
    expect(body.files.map((file) => file.id)).toEqual(['item-a'])
  })

  it('rejects a file from another workspace', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set())
    storeBrainFile({ itemId: 'item-foreign', workspaceId: 'ws-two' })

    const response = await postBrainFolderFile({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1/files`, {
        method: 'POST',
        body: JSON.stringify({ fileId: 'item-foreign' }),
      }),
    })

    expect(response.status).toBe(404)
    expect(folderFiles.get('folder-1')?.size).toBe(0)
  })
})

describe('DELETE /api/brain/folders/$id/files', () => {
  it('rejects a missing body with 400, not 500', async () => {
    setupRequest()
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set())

    const response = await deleteBrainFolderFile({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1/files`, {
        method: 'DELETE',
      }),
    })

    expect(response.status).toBe(400)
  })

  it('removes a member file without deleting it', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set(['item-a']))
    storeBrainFile({ itemId: 'item-a' })

    const response = await deleteBrainFolderFile({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1/files`, {
        method: 'DELETE',
        body: JSON.stringify({ fileId: 'item-a' }),
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      item: { fileCount: number }
      files: unknown[]
    }
    expect(body.item.fileCount).toBe(0)
    expect(body.files).toEqual([])
    expect(mockBrainItems.has('item-a')).toBe(true)
  })

  it('returns 404 when the file is not a member', async () => {
    setupRequest('ws-one')
    folderRows.set('folder-1', {
      id: 'folder-1',
      workspaceId: 'ws-one',
      name: 'Test Case',
      privacy: 'private',
      createdBy: 'user-route',
      createdAt: new Date(),
    })
    folderFiles.set('folder-1', new Set())

    const response = await deleteBrainFolderFile({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1/files`, {
        method: 'DELETE',
        body: JSON.stringify({ fileId: 'item-missing' }),
      }),
    })

    expect(response.status).toBe(404)
  })
})

/** 'private' = creator-only (404 for others, existence un leaked); 'shared' = member-editable. */
describe('folder privacy', () => {
  function seedFolder(row: Partial<FolderRow> & { id: string }) {
    folderRows.set(row.id, {
      workspaceId: 'ws-one',
      name: row.id,
      privacy: 'private',
      createdBy: 'someone-else',
      createdAt: new Date(),
      ...row,
    })
    folderFiles.set(row.id, new Set())
  }

  it('list hides other members’ private folders, shows shared and own', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-private-foreign' })
    seedFolder({ id: 'folder-private-own', createdBy: 'user-route' })
    seedFolder({ id: 'folder-shared', privacy: 'shared' })

    const response = await getBrainFolders({ context: ctx })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: { id: string }[] }
    expect(body.items.map((item) => item.id).sort()).toEqual([
      'folder-private-own',
      'folder-shared',
    ])
  })

  it('detail of another member’s private folder answers 404', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-1' })

    const response = await getBrainFolderDetail({
      context: ctx,
      params: { id: 'folder-1' },
    })

    expect(response.status).toBe(404)
  })

  it('rename of another member’s private folder answers 404 and changes nothing', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-1' })

    const response = await patchBrainFolder({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    })

    expect(response.status).toBe(404)
    expect(folderRows.get('folder-1')?.name).toBe('folder-1')
  })

  it('delete of another member’s private folder answers 404 and keeps the row', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-1' })

    const response = await deleteBrainFolderHandler({
      context: ctx,
      params: { id: 'folder-1' },
    })

    expect(response.status).toBe(404)
    expect(folderRows.has('folder-1')).toBe(true)
  })

  it('adding a file to another member’s private folder answers 404', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-1' })
    storeBrainFile({ itemId: 'item-a' })

    const response = await postBrainFolderFile({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1/files`, {
        method: 'POST',
        body: JSON.stringify({ fileId: 'item-a' }),
      }),
    })

    expect(response.status).toBe(404)
    expect(folderFiles.get('folder-1')?.size).toBe(0)
  })

  it('creator keeps full access to their own private folder', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-1', createdBy: 'user-route' })

    const response = await patchBrainFolder({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Mine' }),
      }),
    })

    expect(response.status).toBe(200)
  })

  it('shared folders stay editable by any workspace member', async () => {
    setupRequest('ws-one', 'user-route')
    seedFolder({ id: 'folder-1', privacy: 'shared' })

    const response = await patchBrainFolder({
      context: ctx,
      params: { id: 'folder-1' },
      request: new Request(`${foldersUrl}/folder-1`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed by member' }),
      }),
    })

    expect(response.status).toBe(200)
    expect(folderRows.get('folder-1')?.name).toBe('Renamed by member')
  })
})
