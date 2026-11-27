import { Result, TaggedError, type Result as ResultValue } from 'better-result'

/**
 * Headroom over the file limit for multipart boundaries, part headers and the
 * small text fields sent beside the file.
 */
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

export class MultipartBodyError extends TaggedError('MultipartBodyError')<{
  reason: 'too_large' | 'invalid'
  message: string
  cause?: unknown
}>() {}

function tooLarge(maxFileBytes: number, cause?: unknown) {
  const megabytes = Math.round(maxFileBytes / (1024 * 1024))
  return new MultipartBodyError({
    reason: 'too_large',
    message: `File exceeds ${megabytes} MB limit`,
    cause,
  })
}

function invalid(message: string, cause?: unknown) {
  return new MultipartBodyError({ reason: 'invalid', message, cause })
}

/**
 * Parses a multipart upload while enforcing a byte limit as the body streams
 * in. `request.formData()` on its own buffers the whole body before anything
 * can check a size, and Content-Length is optional (chunked uploads omit it)
 * and can understate the body, so the header alone cannot bound memory. A
 * declared length over the limit is still rejected before any byte is read.
 */
export async function readMultipartForm(
  request: Request,
  maxFileBytes: number,
): Promise<ResultValue<FormData, MultipartBodyError>> {
  const maxBodyBytes = maxFileBytes + MULTIPART_OVERHEAD_BYTES

  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0) {
      return Result.err(invalid('Invalid Content-Length header'))
    }
    if (length > maxBodyBytes) return Result.err(tooLarge(maxFileBytes))
  }
  if (!request.body) return Result.err(invalid('Missing request body'))

  let receivedBytes = 0
  const limitedBody = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength
        if (receivedBytes > maxBodyBytes) {
          controller.error(tooLarge(maxFileBytes))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )

  return await Result.tryPromise({
    try: async () =>
      await new Response(limitedBody, {
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
      }).formData(),
    catch: (cause) =>
      receivedBytes > maxBodyBytes
        ? tooLarge(maxFileBytes, cause)
        : invalid(
            cause instanceof Error ? cause.message : 'Invalid upload form',
            cause,
          ),
  })
}

/** The response for a multipart body that could not be read. */
export function multipartErrorResponse(error: MultipartBodyError) {
  return Response.json(
    { error: error.message },
    { status: error.reason === 'too_large' ? 413 : 400 },
  )
}
