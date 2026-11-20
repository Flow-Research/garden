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
import type { AttachmentFileStore } from './read-attachment'

const threadId = 'thread-1'
const workspaceId = 'workspace-1'
const issueId = 'issue-1'
const attachmentId = '1e1eb543-57ce-4c90-a102-62a1ca9023ef'
const commentId = 'comment-1'
const ownerUserId = 'member-1'

function createDbMock(args: {
  thread?: { workspaceId: string; ownerUserId: string } | null
  membership?: { id: string } | null
  comments?: Array<{ id: string }>
  attachment?: typeof schema.issueAttachment.$inferSelect | null
}) {
  const selectedRows = new Map<unknown, unknown>([
    [schema.chatThread, args.thread ? [args.thread] : []],
    [
      schema.member,
      args.membership === undefined
        ? [{ id: 'membership-1' }]
        : args.membership
          ? [args.membership]
          : [],
    ],
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

/**
 * The AI SDK allows `execute` to return a streamed iterable. This tool does not,
 * so tests narrow the result before handing it to `toModelOutput`.
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  )
}

/**
 * Minimal file store for the tool's `AttachmentFileStore` surface, so the test
 * exercises the real byte-loading path without an `as unknown as R2Bucket`
 * escape.
 */
function createFiles(bytes: Uint8Array | null) {
  const get = vi.fn(async () =>
    bytes === null
      ? null
      : { arrayBuffer: async () => bytes.buffer as ArrayBuffer },
  )
  return { get } satisfies AttachmentFileStore
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

const input = {
  issue_id_or_identifier: 'GDN-1',
  attachment_id: attachmentId,
}

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
    const files = createFiles(Uint8Array.from([137, 80, 78, 71]))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-1',
      messages: [],
    })
    if (isAsyncIterable(output))
      throw new Error('Attachment tool streamed its output.')
    const toModelOutput = attachmentTool.toModelOutput
    if (!toModelOutput) throw new Error('Attachment tool has no model output.')
    const modelOutput = await toModelOutput({
      input,
      output,
      toolCallId: 'tool-call-1',
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

  it('returns text attachments inline instead of a model part', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [],
      attachment: {
        ...imageAttachment,
        filename: 'notes.txt',
        r2Key: 'workspace/issue/notes.txt',
        contentType: 'text/plain',
        sizeBytes: 5,
      },
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(Uint8Array.from([104, 101, 108, 108, 111]))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-2',
      messages: [],
    })
    if (isAsyncIterable(output))
      throw new Error('Attachment tool streamed its output.')
    const toModelOutput = attachmentTool.toModelOutput
    if (!toModelOutput) throw new Error('Attachment tool has no model output.')

    expect(output).toMatchObject({
      kind: 'text',
      issue_id: issueId,
      content: 'hello',
    })
    expect(
      await toModelOutput({ input, output, toolCallId: 'tool-call-2' }),
    ).toEqual({
      type: 'text',
      value: 'hello',
    })
  })

  it('rejects image bytes above the shared inline model output cap', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [{ id: commentId }],
      attachment: imageAttachment,
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(new Uint8Array(3.5 * 1024 * 1024 + 1))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-3',
      messages: [],
    })
    if (isAsyncIterable(output))
      throw new Error('Attachment tool streamed its output.')
    const toModelOutput = attachmentTool.toModelOutput
    if (!toModelOutput) throw new Error('Attachment tool has no model output.')

    expect(
      await toModelOutput({ input, output, toolCallId: 'tool-call-3' }),
    ).toEqual({
      type: 'error-text',
      value:
        'Read screenshot.png, but it exceeds the 3.5 MiB inline model output limit.',
    })
  })

  it('rejects text attachments above the shared inline model output cap', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [],
      attachment: {
        ...imageAttachment,
        filename: 'notes.txt',
        r2Key: 'workspace/issue/notes.txt',
        contentType: 'text/plain',
        sizeBytes: 3.5 * 1024 * 1024 + 1,
      },
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(new Uint8Array(3.5 * 1024 * 1024 + 1).fill(97))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-4',
      messages: [],
    })

    expect(output).toEqual({
      error:
        'Read notes.txt, but it exceeds the 3.5 MiB inline model output limit.',
    })
  })

  it('does not read bytes when the attachment is outside the requested issue', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [],
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(Uint8Array.from([137, 80, 78, 71]))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-4',
      messages: [],
    })

    expect(output).toEqual({
      error: 'Attachment not found on the requested issue.',
    })
    expect(files.get).not.toHaveBeenCalled()
  })

  it('denies the read when the chat owner no longer belongs to the workspace', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      membership: null,
      comments: [{ id: commentId }],
      attachment: imageAttachment,
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(Uint8Array.from([137, 80, 78, 71]))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-5',
      messages: [],
    })

    expect(output).toEqual({
      error: 'Chat owner no longer belongs to this workspace.',
    })
    expect(files.get).not.toHaveBeenCalled()
  })

  it('rejects the stored size before reading the stored object', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [{ id: commentId }],
      attachment: {
        ...imageAttachment,
        filename: 'notes.txt',
        r2Key: 'workspace/issue/notes.txt',
        contentType: 'text/plain',
        sizeBytes: 3.5 * 1024 * 1024 + 1,
      },
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(Uint8Array.from([137, 80, 78, 71]))
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-6',
      messages: [],
    })

    expect(output).toEqual({
      error:
        'Read notes.txt, but it exceeds the 3.5 MiB inline model output limit.',
    })
    expect(files.get).not.toHaveBeenCalled()
  })

  it('re-checks the current tool policy before reloading bytes', async () => {
    const db = createDbMock({
      thread: { workspaceId, ownerUserId },
      comments: [{ id: commentId }],
      attachment: imageAttachment,
    })
    getPooledDbMock.mockReturnValue(db as never)
    const files = createFiles(Uint8Array.from([137, 80, 78, 71]))
    const canUseTool = vi.fn(() => false)
    const attachmentTool = createReadChatIssueAttachmentTool({
      databaseUrl: 'postgres://test',
      threadId,
      files,
      canUseTool,
    })

    const execute = attachmentTool.execute
    if (!execute) throw new Error('Attachment tool has no execute function.')
    const output = await execute(input, {
      toolCallId: 'tool-call-7',
      messages: [],
    })
    const toModelOutput = attachmentTool.toModelOutput
    if (!toModelOutput) throw new Error('Attachment tool has no model output.')

    expect(output).toEqual({
      error:
        'Reading issue attachments is not allowed by the current agent or Team policy.',
    })
    if (isAsyncIterable(output))
      throw new Error('Attachment tool streamed its output.')
    expect(
      await toModelOutput({ input, output, toolCallId: 'tool-call-7' }),
    ).toEqual({
      type: 'error-text',
      value:
        'Reading issue attachments is not allowed by the current agent or Team policy.',
    })
    expect(canUseTool).toHaveBeenCalledWith('read_issue_attachment')
    expect(files.get).not.toHaveBeenCalled()
  })
})
