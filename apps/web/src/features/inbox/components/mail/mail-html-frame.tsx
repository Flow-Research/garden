// Adapted from Cloudflare Agentic Inbox's EmailIframe (Apache-2.0).
// Pinned source and notice: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import createDOMPurify from 'dompurify'
import { useMemo, useSyncExternalStore } from 'react'

const subscribeToBrowser = () => () => undefined

function buildEmailDocument(body: string): string {
  const purifier = createDOMPurify(window)
  const cleanBody = purifier.sanitize(body, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    ADD_ATTR: ['target', 'rel'],
    FORCE_BODY: true,
  })

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; base-uri 'none'; form-action 'none'; object-src 'none';">
<style>
* { box-sizing: border-box; }
html { background: #fff; color-scheme: light; }
body {
  margin: 0;
  padding: 16px;
  overflow-wrap: anywhere;
  background: #fff;
  color: #1a1a1a;
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
[style*="position: fixed"], [style*="position:fixed"],
[style*="position: absolute"], [style*="position:absolute"] { position: relative !important; }
a { color: #2563eb; }
img { max-width: 100%; height: auto; }
blockquote { margin-left: 0; border-left: 3px solid #d1d5db; padding-left: 1em; color: #6b7280; }
pre { overflow-x: auto; border-radius: 6px; background: #f3f4f6; padding: 12px; font-size: 13px; }
table { max-width: 100%; border-collapse: collapse; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { margin: 4px 0; padding-left: 20px; }
</style>
</head>
<body>${cleanBody}</body>
</html>`
}

/**
 * Sanitizes mail HTML, applies a strict CSP, and isolates it in an opaque-origin
 * iframe. Browser detection uses `useSyncExternalStore`, so hydration is safe
 * without the banned `useEffect` lifecycle.
 */
export function MailHtmlFrame({
  body,
  title = 'Email content',
  className,
}: {
  body: string
  title?: string
  className?: string
}) {
  const inBrowser = useSyncExternalStore(
    subscribeToBrowser,
    () => true,
    () => false,
  )
  const srcDoc = useMemo(
    () => (inBrowser ? buildEmailDocument(body) : ''),
    [body, inBrowser],
  )

  return (
    <iframe
      className={className ?? 'block min-h-48 w-full border-0'}
      sandbox="allow-popups allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      title={title}
    />
  )
}
