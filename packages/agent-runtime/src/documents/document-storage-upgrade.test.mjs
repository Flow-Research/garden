import { DatabaseSync } from 'node:sqlite'
import { Workspace } from '@cloudflare/shell'
import { describe, expect, it, vi } from 'vitest'
import { createAITools } from '@cloudflare/computer/tools/ai-sdk'
import { createChatReadTool } from '../legacy-chat-media'
import { getDocumentVersionBytes } from './document-tools'

const mocks = vi.hoisted(() => ({ getPooledDb: vi.fn() }))
vi.mock('@garden/db/runtime', () => ({ getPooledDb: mocks.getPooledDb }))

describe('stable document storage across runtime upgrades', () => {
  it.each([false, true])(
    'reads an existing document, spilled to R2: %s',
    async (spilled) => {
      const db = new DatabaseSync(':memory:')
      const sql = {
        databaseSize: 0,
        exec: (statement, ...params) => db.prepare(statement).all(...params),
      }
      const objects = new Map()
      const bucket = {
        put: async (key, bytes) => {
          objects.set(key, bytes)
        },
        get: async (key) =>
          objects.has(key) ? new Response(objects.get(key)) : null,
      }
      const options = {
        sql,
        r2: bucket,
        name: () => 'thread-1',
        inlineThreshold: spilled ? 1 : 100,
      }
      const storagePath = '/documents/old-report.txt'
      await new Workspace(options).writeFileBytes(
        storagePath,
        new TextEncoder().encode('Approved report'),
      )
      expect(objects.size).toBe(spilled ? 1 : 0)
      // Think 0.10 saved the original data URL string at the path in the transcript.
      const marker = '/attachments/evicted/old-message-0.png'
      const data = 'iVBORw0KGgo='
      await new Workspace(options).writeFile(
        marker,
        'data:image/png;base64,' + data,
      )
      const nativeBytes = new TextEncoder().encode('current thread file')
      const native = {
        fs: {
          stat: async () => ({
            isFile: true,
            size: nativeBytes.length,
            mtime: 0,
          }),
          readFile: async () => new Response(nativeBytes).body,
        },
      }
      const read = createChatReadTool(
        createAITools({ workspace: native }),
        new Workspace(options),
      )
      const current = await read.execute({ path: '/workspace/current.txt' }, {})
      expect(JSON.stringify(current)).toContain('current thread file')
      const media = await read.execute({ path: marker }, {})
      expect(media).toMatchObject({ kind: 'image', path: marker, sizeBytes: 8 })
      expect(JSON.stringify(media)).toContain(data)
      const rows = [
        [
          {
            threadId: 'thread-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-1',
          },
        ],
        [{ storagePath, filename: 'old-report.txt', fileType: 'txt' }],
      ]
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        limit: async () => rows.shift(),
      }
      mocks.getPooledDb.mockReturnValue({ select: () => query })
      const result = await getDocumentVersionBytes({
        context: {
          databaseUrl: 'postgres://test',
          threadId: 'thread-1',
          workspace: new Workspace(options),
        },
        documentId: 'document-1',
      })
      expect(result.ok && result.bytes.toString()).toBe('Approved report')
      db.close()
    },
  )
})
