// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AppRequestContext } from '@/lib/server/context'
import { invokeRouteHandler } from '@/test/route-handler'
import { MULTIPART_OVERHEAD_BYTES } from '@/lib/server/multipart'
import { Route } from './upload-file'

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  requireAppRequestContext: vi.fn(),
  requireWorkspaceContext: vi.fn(),
}))

vi.mock('@garden/core/constants/upload', () => ({ MAX_FILE_SIZE: 1024 }))
vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: mocks.requireAppRequestContext,
}))
vi.mock('@/lib/server/control-plane', () => ({
  badRequest: (message: string) =>
    Response.json({ error: message }, { status: 400 }),
  json: (data: unknown, status = 200) => Response.json(data, { status }),
  requireWorkspaceContext: mocks.requireWorkspaceContext,
  serviceUnavailable: (message: string) =>
    Response.json({ error: message }, { status: 503 }),
}))
vi.mock('@garden/server/issues/server', () => ({ toIssueAttachment: vi.fn() }))
vi.mock('@garden/agent-runtime', () => ({
  buildContentDisposition: vi.fn(),
  normalizeDownloadFilename: (filename: string) => filename,
}))

const BOUNDARY = 'upload-test-boundary'

/** A chunked multipart upload with no Content-Length header. */
function chunkedUpload(fileBytes: number) {
  const encoder = new TextEncoder()
  const parts = [
    encoder.encode(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    new Uint8Array(fileBytes),
    encoder.encode(`\r\n--${BOUNDARY}--\r\n`),
  ]
  return new Request('https://garden.test/api/upload-file', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = parts.shift()
        if (next) controller.enqueue(next)
        else controller.close()
      },
    }),
    duplex: 'half',
  } as RequestInit)
}

describe('POST /api/upload-file', () => {
  it('rejects an oversized upload sent without Content-Length before storing it', async () => {
    mocks.requireAppRequestContext.mockReturnValue({
      env: { FILES: { put: mocks.put } },
    })
    mocks.requireWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      session: { user: { id: 'user-1' } },
    })
    const request = chunkedUpload(1024 + MULTIPART_OVERHEAD_BYTES + 1)
    expect(request.headers.get('content-length')).toBeNull()

    const response = await invokeRouteHandler(Route, 'POST', {
      context: {} as AppRequestContext,
      request,
    })

    expect(response.status).toBe(413)
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
