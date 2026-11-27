// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MULTIPART_OVERHEAD_BYTES,
  multipartErrorResponse,
  readMultipartForm,
} from './multipart'

const MAX_FILE_BYTES = 1024
const BOUNDARY = 'garden-test-boundary'

function multipartBody(fileBytes: number) {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${BOUNDARY}--\r\n`)
  const body = new Uint8Array(head.length + fileBytes + tail.length)
  body.set(head, 0)
  body.set(tail, head.length + fileBytes)
  return body
}

/** A request whose body streams in 64 KiB chunks with no Content-Length. */
function chunkedRequest(body: Uint8Array) {
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) {
        controller.close()
        return
      }
      controller.enqueue(body.subarray(offset, offset + 64 * 1024))
      offset += 64 * 1024
    },
  })
  return new Request('https://garden.test/api/upload-file', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: stream,
    duplex: 'half',
  } as RequestInit)
}

describe('readMultipartForm', () => {
  it('parses a form within the limit', async () => {
    const result = await readMultipartForm(
      chunkedRequest(multipartBody(512)),
      MAX_FILE_BYTES,
    )

    expect(result.isOk()).toBe(true)
    const file = result.isOk() ? result.value.get('file') : null
    expect(file instanceof File ? file.size : null).toBe(512)
  })

  it('stops reading an oversized body sent without Content-Length', async () => {
    const request = chunkedRequest(
      multipartBody(MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
    )
    expect(request.headers.get('content-length')).toBeNull()

    const result = await readMultipartForm(request, MAX_FILE_BYTES)

    expect(result.isErr() && result.error.reason).toBe('too_large')
    expect(result.isErr() && multipartErrorResponse(result.error).status).toBe(
      413,
    )
  })

  it('rejects a declared length over the limit without reading the body', async () => {
    let pulled = false
    const request = new Request('https://garden.test/api/upload-file', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'content-length': String(MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
      },
      // highWaterMark 0: the stream pulls only when something reads it.
      body: new ReadableStream(
        {
          pull() {
            pulled = true
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: 'half',
    } as RequestInit)

    const result = await readMultipartForm(request, MAX_FILE_BYTES)

    expect(result.isErr() && result.error.reason).toBe('too_large')
    expect(pulled).toBe(false)
  })

  it('rejects a malformed Content-Length', async () => {
    const request = new Request('https://garden.test/api/upload-file', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'content-length': 'lots',
      },
      body: new ReadableStream(),
      duplex: 'half',
    } as RequestInit)

    const result = await readMultipartForm(request, MAX_FILE_BYTES)

    expect(result.isErr() && result.error.reason).toBe('invalid')
    expect(result.isErr() && multipartErrorResponse(result.error).status).toBe(
      400,
    )
  })

  it('rejects a body that is not multipart', async () => {
    const request = new Request('https://garden.test/api/upload-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    const result = await readMultipartForm(request, MAX_FILE_BYTES)

    expect(result.isErr() && result.error.reason).toBe('invalid')
  })
})
