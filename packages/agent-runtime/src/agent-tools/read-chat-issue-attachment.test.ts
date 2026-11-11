import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import * as schema from '@garden/db/schema'

const { getPooledDbMock, readIssueMock } = vi.hoisted(() => ({
  getPooledDbMock: vi.fn(),
  readIssueMock: vi.fn(),
}))

vi.mock('@garden/db/runtime', () => ({ getPooledDb: getPooledDbMock }))
vi.mock('@garden/server/issues/server', () => ({ readIssue: readIssueMock }))

import { createReadChatIssueAttachmentTool } from './read-chat-issue-attachment'

const threadId = 'thread-1'
const workspaceId = 'workspace-1'
const issueId = 'issue-1'
const attachmentId = '1e1eb543-57ce-4c90-a102-62a1ca9023ef'
const commentId = 'comment-1'
const ownerUserId = 'member-1'

function createDbMock(args: {
  thread?: { workspaceId: string; ownerUserId: string } | null
  comments?: Array<{ id: string }>
  attachment?: typeof schema.issueAttachment.$inferSelect | null
}) {
  const selectedRows = new Map<unknown, unknown>([
    [schema.chatThread, args.thread ? [args.thread] : []],
    [schema.issueComment, args.comments ?? []],
    [schema.issueAttachment, args.attachment ? [args.attachment] : []],
  ])
  const db = {
    select: vi.fn(() => {
      let table: unknown
      const rows = () => selectedRows.get(table) ?? []
      const builder = {
        from: (selectedTable: unknown) => {
          table = selectedTable
          return builder
        },
        where: () =>
          table === schema.issueComment ? Promise.resolve(rows()) : builder,
        limit: async () => rows(),
      }
      return builder
    }),
  }
  return db
}

const imageAttachment = {
  id: attachmentId,
  workspaceId,
  issueId: null,
  commentId,
  uploaderType: 'member',
  uploaderId: 'member-1',
  filename: 'screenshot.png',
  r2Key: 'workspace/issue/screenshot.png',
  contentType: 'image/png',
  sizeBytes: 4,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies typeof schema.issueAttachment.$inferSelect

describe('chat read_issue_attachment tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readIssueMock.mockResolvedValue(Result.ok({ issue_id: issueId }) as never)
  })

  it('passes image bytes privately to the model for a comment attachment', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [{ id: commentId }],
      attachment: imageAttachment,
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
      }),
    } as unknown as R2Bucket
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })
    const input = {
      issue_id_or_identifier: 'GDN-1',
      attachment_id: attachmentId,
    }

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-1',
      messages: [],
    })
    const toModelOutput = attachmentTool.toModelOutput as unknown as (args: {
      input: unknown
      output: unknown
    }) => Promise<unknown>
    const modelOutput = await toModelOutput({
      input,
      output: {
        kind: 'image',
        note: 'Read screenshot.png (image/png, 4 B).',
      },
    })

    expect(output).toMatchObject({
      attachment_id: attachmentId,
      issue_id: issueId,
      comment_id: commentId,
      kind: 'image',
    })
    expect(modelOutput).toMatchObject({
      type: 'content',
      value: [
        { type: 'text', text: expect.stringContaining('screenshot.png') },
        { type: 'image-data', mediaType: 'image/png', data: 'iVBORw==' },
      ],
    })
    expect(files.get).toHaveBeenCalledWith(imageAttachment.r2Key)
    expect(readIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewerUserId: ownerUserId }),
    )
  })

  it('does not read bytes when the attachment is outside the requested issue', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [],
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = { get: vi.fn() } as unknown as R2Bucket
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(
      {
        issue_id_or_identifier: 'GDN-1',
        attachment_id: attachmentId,
      },
      { toolCallId: 'tool-call-2', messages: [] },
    )

    expect(output).toEqual({
      error: 'Attachment not found on the requested issue.',
    })
    expect(files.get).not.toHaveBeenCalled()
  })
})
