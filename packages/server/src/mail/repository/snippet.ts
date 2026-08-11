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

/** Removes stylesheet rules incorrectly emitted in Gmail text alternatives. */
function stripLeadingCssRules(text: string) {
  const leadingRule =
    /^\s*(?:(?:@(?:font-face|page|keyframes|media|supports)\b)|(?:(?:html|body|table|thead|tbody|tr|td|th|p|a|span|img|h[1-6]|ul|ol|li)\b|[.#][a-z_-])[^{}]{0,240})\{[^{}]*\}\s*/i
  let result = text

  for (let rule = 0; rule < 64; rule += 1) {
    const next = result.replace(leadingRule, '')
    if (next === result) break
    result = next
  }

  return result
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
  const source = (textBody ?? htmlBody ?? '')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<head\b[^>]*>[^]*?<\/head>/gi, ' ')
    .replace(/<(style|script|noscript|template|svg)\b[^>]*>[^]*?<\/\1>/gi, ' ')
    .replace(
      /<([a-z][\w-]*)\b[^>]*(?:\bhidden\b|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|max-height\s*:\s*0))[^>]*>[^]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<[^>]*>/g, ' ')

  return decodeHtmlEntities(stripLeadingCssRules(source))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}
