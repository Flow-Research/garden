import { buildContentDisposition } from '@garden/agent-runtime'

/**
 * Media types the browser may render inline from Garden's own origin. Anything
 * that can execute script there (HTML, SVG, XML, JavaScript) is always served
 * as a download, whatever type the uploader or agent claimed.
 */
const INLINE_SAFE_MEDIA_TYPES = new Set([
  'application/json',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
  'video/mp4',
  'video/webm',
])

function baseMediaType(contentType: string) {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isInlineSafeMediaType(contentType: string) {
  return INLINE_SAFE_MEDIA_TYPES.has(baseMediaType(contentType))
}

/**
 * Headers for serving user- or agent-supplied bytes. Unsafe types are forced to
 * `attachment`, `nosniff` stops the browser from reinterpreting the bytes, and
 * every non-PDF response is CSP-sandboxed so even a mislabelled file cannot run
 * script against the app origin. PDFs are left unsandboxed because browser PDF
 * viewers refuse to render inside a CSP sandbox.
 */
export function storedObjectHeaders(input: {
  contentType: string | null | undefined
  filename: string
  download: boolean
}) {
  const contentType = input.contentType || 'application/octet-stream'
  const inline = !input.download && isInlineSafeMediaType(contentType)
  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set(
    'Content-Disposition',
    buildContentDisposition(inline ? 'inline' : 'attachment', input.filename),
  )
  headers.set('X-Content-Type-Options', 'nosniff')
  if (baseMediaType(contentType) !== 'application/pdf') {
    headers.set('Content-Security-Policy', "sandbox; default-src 'none'")
  }
  return headers
}
