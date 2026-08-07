const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|tiff?)$/i
const EXPLICIT_FILE = /^!file\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/
const STANDALONE_LINK = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
}

function fileCardMarkup(filename: string, href: string): string {
  return `<div data-type="fileCard" data-href="${escapeAttribute(href)}" data-filename="${escapeAttribute(filename)}"></div>`
}

/** Returns whether a URL belongs to the configured upload host or direct S3. */
export function isCdnUrl(url: string, cdnDomain: string): boolean {
  if (!URL.canParse(url)) return false
  const hostname = new URL(url).hostname
  return hostname === cdnDomain || hostname.endsWith('.amazonaws.com')
}

/** Identifies uploaded, non-image URLs that should render as attachment cards. */
export function isFileCardUrl(url: string, cdnDomain: string): boolean {
  if (!isCdnUrl(url, cdnDomain)) return false
  return !IMAGE_PATH.test(new URL(url).pathname)
}

/** Converts explicit and legacy standalone file links into sanitized card nodes. */
export function preprocessFileCards(
  markdown: string,
  cdnDomain: string,
): string {
  return markdown
    .split('\n')
    .map((line) => {
      const content = line.trim()
      const explicit = EXPLICIT_FILE.exec(content)
      if (explicit?.[1] !== undefined && explicit[2]) {
        return fileCardMarkup(explicit[1], explicit[2])
      }

      const legacy = STANDALONE_LINK.exec(content)
      if (!legacy?.[1] || !legacy[2] || !isFileCardUrl(legacy[2], cdnDomain)) {
        return line
      }
      return fileCardMarkup(legacy[1], legacy[2])
    })
    .join('\n')
}
