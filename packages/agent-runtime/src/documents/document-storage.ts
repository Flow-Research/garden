import { Buffer } from 'node:buffer'
import { Result, TaggedError } from 'better-result'

export class DocumentStorageError extends TaggedError('DocumentStorageError')<{
  message: string
}>() {}

export function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim()
  const base = trimmed || 'download'
  return base.replace(/[\x00-\x1F\x7F]/g, '_').replace(/[\\/]/g, '_')
}

export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name).replace(/["\\]/g, '_')
}

export function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

export function buildContentDisposition(
  kind: 'inline' | 'attachment',
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename)
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`
}

export function storageKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, '.bin')}`
}

export function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, '.docx')}`
}

export function versionStorageKey(
  _userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `/documents/${docId}/versions/${versionSlug}/${normalizeDownloadFilename(filename)}`
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot < 0) return fallback
  const ext = filename.slice(lastDot).toLowerCase()
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback
}

export async function uploadFile(
  bucket: R2Bucket,
  key: string,
  content: ArrayBuffer | Uint8Array | Buffer,
  contentType: string,
) {
  return Result.tryPromise({
    try: async () => {
      await bucket.put(key, content, {
        httpMetadata: { contentType },
      })
    },
    catch: (error) =>
      new DocumentStorageError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
}

export async function downloadFile(bucket: R2Bucket, key: string) {
  const objectResult = await Result.tryPromise({
    try: async () => await bucket.get(key),
    catch: (error) =>
      new DocumentStorageError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
  if (objectResult.isErr()) return objectResult
  if (!objectResult.value) {
    return Result.err(
      new DocumentStorageError({ message: `Document bytes not found: ${key}` }),
    )
  }
  const object = objectResult.value

  return Result.tryPromise({
    try: async () => Buffer.from(await object.arrayBuffer()),
    catch: (error) =>
      new DocumentStorageError({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
}

export function documentDownloadUrl(documentId: string, filename: string) {
  const url = new URL(`/api/documents/${documentId}/docx`, 'https://garden.local')
  url.searchParams.set('filename', filename)
  return `${url.pathname}${url.search}`
}
