import sanitizeHtmlLibrary from 'sanitize-html'

/**
 * Sanitizes authored HTML before it becomes durable mail content. The allowlist
 * matches the formatting emitted by Garden's Zero-derived Tiptap composer and
 * deliberately excludes scripts, forms, remote media, inline event handlers,
 * and arbitrary CSS. Opened mail is sanitized again at the rendering boundary.
 */
export function sanitizeAuthoredMailHtml(html: string): string | null {
  const sanitized = sanitizeHtmlLibrary(html, {
    allowedTags: [
      'a',
      'blockquote',
      'br',
      'code',
      'em',
      'h1',
      'h2',
      'h3',
      'hr',
      'li',
      'ol',
      'p',
      'pre',
      's',
      'strong',
      'u',
      'ul',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: {
          ...attributes,
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  }).trim()

  return sanitized.length === 0 || sanitized === '<p></p>' ? null : sanitized
}
