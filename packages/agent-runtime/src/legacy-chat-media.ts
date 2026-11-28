import { Buffer } from 'node:buffer'
import type { ToolSet } from 'ai'
import { createReadTool } from '@cloudflare/computer/tools/ai-sdk'
import type { WorkspaceFsLike } from '@cloudflare/shell'

const evictionPath =
  /^\/attachments\/evicted\/[A-Za-z0-9_-]+-\d+\.[A-Za-z0-9]+$/

/** Think 0.10 wrote data URLs and text here. Read them from this facet only. */
export function createChatReadTool(tools: ToolSet, legacy: WorkspaceFsLike) {
  // createAITools declares a generic ToolSet. Its read entry comes from createReadTool.
  const native = tools.read as ReturnType<typeof createReadTool>
  const read = native.execute
  if (!read) throw new Error('The workspace read tool has no executor.')
  return {
    ...native,
    async execute(
      input: Parameters<typeof read>[0],
      options: Parameters<typeof read>[1],
    ) {
      if (!evictionPath.test(input.path)) return read(input, options)
      const entry = await legacy.lstat(input.path)
      if (!entry || entry.type !== 'file') return read(input, options)
      const stored = await legacy.readFile(input.path)
      if (stored === null || (!stored && entry.size > 0))
        return { error: 'Stored chat media is unavailable.' }
      const header = /^data:[^,]*;base64,/i.exec(stored)
      const bytes = header
        ? Buffer.from(stored.slice(header[0].length), 'base64')
        : Buffer.from(stored)
      const media = createReadTool({
        store: {
          stat: async () => ({ size: bytes.length, mtime: 0 }),
          readAll: async () => bytes,
          async *readChunks(_path, offset = 0, length) {
            yield bytes.subarray(
              offset,
              length === undefined ? undefined : offset + length,
            )
          },
          async write() {
            throw new Error('Legacy chat media is read-only.')
          },
        },
      })
      if (!media.execute)
        throw new Error('The media read tool has no executor.')
      return media.execute(input, options)
    },
  }
}
