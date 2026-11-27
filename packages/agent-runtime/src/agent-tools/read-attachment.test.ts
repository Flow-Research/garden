import { describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import type * as schema from '@garden/db/schema'
import {
  MAX_MODEL_ATTACHMENT_BYTES,
  attachmentKind,
  attachmentModelOutput,
  formatAttachmentSize,
  loadAttachmentText,
  type AttachmentFileStore,
} from './read-attachment'

const attachment = {
  id: '1e1eb543-57ce-4c90-a102-62a1ca9023ef',
  workspaceId: 'workspace-1',
  issueId: 'issue-1',
  commentId: null,
  uploaderType: 'member',
  uploaderId: 'member-1',
  filename: 'notes.txt',
  r2Key: 'workspace/issue/notes.txt',
  contentType: 'text/plain',
  sizeBytes: 5,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies typeof schema.issueAttachment.$inferSelect

function createFiles(bytes: Uint8Array | null) {
  return {
    get: vi.fn(async () =>
      bytes === null ? null : { arrayBuffer: async () => bytes.slice().buffer },
    ),
  } satisfies AttachmentFileStore
}

describe('attachment helpers shared by issue runs and chats', () => {
  it('maps stored media types onto transcript kinds', () => {
    expect(attachmentKind('image/png')).toBe('image')
    expect(attachmentKind('image/svg+xml')).toBe('binary')
    expect(attachmentKind('image/tiff')).toBe('binary')
    expect(attachmentKind('application/pdf')).toBe('file')
    expect(attachmentKind('text/markdown')).toBe('text')
    expect(attachmentKind('application/json')).toBe('text')
    expect(attachmentKind('application/vnd.garden+json')).toBe('text')
    expect(attachmentKind('application/zip')).toBe('binary')
  })

  it('formats sizes in the unit the note text uses', () => {
    expect(formatAttachmentSize(4)).toBe('4 B')
    expect(formatAttachmentSize(2048)).toBe('2.0 KiB')
    expect(formatAttachmentSize(MAX_MODEL_ATTACHMENT_BYTES)).toBe('3.5 MiB')
  })
})

describe('loadAttachmentText', () => {
  it('decodes text at exactly the inline cap', async () => {
    const files = createFiles(
      new Uint8Array(MAX_MODEL_ATTACHMENT_BYTES).fill(97),
    )

    const result = await loadAttachmentText(files, attachment)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw new Error(result.error.message)
    expect(result.value).toHaveLength(MAX_MODEL_ATTACHMENT_BYTES)
  })

  it('rejects text one byte over the inline cap before decoding', async () => {
    const files = createFiles(
      new Uint8Array(MAX_MODEL_ATTACHMENT_BYTES + 1).fill(97),
    )

    const result = await loadAttachmentText(files, attachment)

    expect(result.isErr()).toBe(true)
    if (result.isOk()) throw new Error('expected an oversized text error')
    expect(result.error.message).toBe(
      'Read notes.txt, but it exceeds the 3.5 MiB inline model output limit.',
    )
  })

  it('rejects the stored size before reading the stored object', async () => {
    const files = createFiles(new Uint8Array([104, 105]))

    const result = await loadAttachmentText(files, {
      ...attachment,
      sizeBytes: MAX_MODEL_ATTACHMENT_BYTES + 1,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) throw new Error('expected an oversized text error')
    expect(result.error.message).toBe(
      'Read notes.txt, but it exceeds the 3.5 MiB inline model output limit.',
    )
    expect(files.get).not.toHaveBeenCalled()
  })

  it('keeps large issue-run text reads available', async () => {
    const bytes = new Uint8Array(MAX_MODEL_ATTACHMENT_BYTES + 1).fill(97)
    const result = await loadAttachmentText(
      createFiles(bytes),
      { ...attachment, sizeBytes: bytes.byteLength },
      Number.POSITIVE_INFINITY,
    )
    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw new Error(result.error.message)
    expect(result.value).toHaveLength(bytes.byteLength)
  })

  it('reports a missing stored object', async () => {
    const result = await loadAttachmentText(createFiles(null), attachment)

    expect(result.isErr()).toBe(true)
    if (result.isOk()) throw new Error('expected a missing bytes error')
    expect(result.error.message).toBe('Attachment bytes not found.')
  })
})

describe('attachmentModelOutput', () => {
  const resolveBytes = () =>
    Promise.resolve(
      Result.ok({ attachment, bytes: new Uint8Array([104, 105]) }),
    )

  it('returns small text inline', async () => {
    expect(
      await attachmentModelOutput({
        output: { kind: 'text', content: 'hello' },
        resolveBytes,
      }),
    ).toEqual({ type: 'text', value: 'hello' })
  })

  it('keeps legacy large issue-run text in model output', async () => {
    expect(
      await attachmentModelOutput({
        output: {
          kind: 'text',
          content: 'a'.repeat(MAX_MODEL_ATTACHMENT_BYTES + 1),
        },
        resolveBytes,
      }),
    ).toEqual({
      type: 'text',
      value: 'a'.repeat(MAX_MODEL_ATTACHMENT_BYTES + 1),
    })
  })

  it('passes image bytes through as a private model part', async () => {
    expect(
      await attachmentModelOutput({
        output: { kind: 'image', note: 'Read notes.txt.' },
        resolveBytes: async () =>
          Result.ok({
            attachment: { ...attachment, contentType: 'image/png' },
            bytes: new Uint8Array([104, 105]),
          }),
      }),
    ).toMatchObject({
      type: 'content',
      value: [
        { type: 'text', text: 'Read notes.txt.' },
        { type: 'image-data', mediaType: 'image/png', data: 'aGk=' },
      ],
    })
  })

  it('does not replay older unsupported image parts', async () => {
    expect(
      await attachmentModelOutput({
        output: { kind: 'image' },
        resolveBytes: async () =>
          Result.ok({
            attachment: { ...attachment, contentType: 'image/svg+xml' },
            bytes: new Uint8Array([104, 105]),
          }),
      }),
    ).toEqual({
      type: 'error-text',
      value:
        'Attachment type image/svg+xml is not supported for this model output.',
    })
  })

  it('reports a failing resolver as tool error text', async () => {
    expect(
      await attachmentModelOutput({
        output: { kind: 'image', note: 'Read notes.txt.' },
        resolveBytes: async () => Result.err('Attachment not found.'),
      }),
    ).toEqual({ type: 'error-text', value: 'Attachment not found.' })
  })
})
