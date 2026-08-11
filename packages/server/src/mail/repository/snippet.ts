/** Decodes the small HTML entity set emitted by common transactional mailers. */
function decodeHtmlEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/**
 * Produces visible plain text for list rows without carrying stylesheet,
 * tracking-preheader, or active-document content into the inbox. This adapts
 * Cloudflare Agentic Inbox's `getSnippetText` cleanup and additionally removes
 * hidden preheaders observed in imported Gmail HTML. Canonical bodies remain
 * untouched and the opened-message renderer still applies DOMPurify + CSP.
 */
export function mailMessageSnippet(
  textBody: string | null,
  htmlBody: string | null,
) {
  const source =
    textBody ??
    htmlBody
      ?.replace(/<!--[^]*?-->/g, ' ')
      .replace(/<head\b[^>]*>[^]*?<\/head>/gi, ' ')
      .replace(
        /<(style|script|noscript|template|svg)\b[^>]*>[^]*?<\/\1>/gi,
        ' ',
      )
      .replace(
        /<([a-z][\w-]*)\b[^>]*(?:\bhidden\b|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|max-height\s*:\s*0))[^>]*>[^]*?<\/\1>/gi,
        ' ',
      )
      .replace(/<[^>]*>/g, ' ') ??
    ''

  return decodeHtmlEntities(source).replace(/\s+/g, ' ').trim().slice(0, 180)
}
