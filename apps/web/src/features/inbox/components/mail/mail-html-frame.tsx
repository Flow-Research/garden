// Adapted from Cloudflare Agentic Inbox's EmailIframe (Apache-2.0).
// Pinned source and notice: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import createDOMPurify from 'dompurify'
import { useMemo, useSyncExternalStore } from 'react'

const subscribeToBrowser = () => () => undefined
const MAX_AUTO_FRAME_HEIGHT = 4_000

type MailFrameHeightMessage = {
  __gardenMailFrameHeight: true
  height: number
}

/**
 * Bridges Cloudflare's opaque iframe height reports into React without an
 * effect. Sender HTML stays unable to access Garden; only the exact frame
 * window may update its own cached height.
 */
function makeFrameHeightStore() {
  let frame: HTMLIFrameElement | null = null
  let height = 100
  const listeners = new Set<() => void>()

  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== frame?.contentWindow) return
    if (!event.data || typeof event.data !== 'object') return
    const data = event.data as Partial<MailFrameHeightMessage>
    if (
      data.__gardenMailFrameHeight !== true ||
      typeof data.height !== 'number' ||
      !Number.isFinite(data.height) ||
      data.height <= 0
    ) {
      return
    }
    const nextHeight = Math.min(MAX_AUTO_FRAME_HEIGHT, Math.ceil(data.height))
    if (nextHeight === height) return
    height = nextHeight
    listeners.forEach((listener) => listener())
  }

  return {
    connect: (nextFrame: HTMLIFrameElement | null) => {
      if (frame === nextFrame) return
      if (frame) window.removeEventListener('message', onMessage)
      frame = nextFrame
      if (frame) window.addEventListener('message', onMessage)
    },
    getSnapshot: () => height,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Builds the sanitized srcdoc used by Cloudflare's EmailIframe pattern. */
function buildEmailDocument(body: string, autoSize: boolean): string {
  const purifier = createDOMPurify(window)
  purifier.addHook('uponSanitizeAttribute', (_node, data) => {
    if (
      (data.attrName === 'src' || data.attrName === 'srcset') &&
      /^https?:/i.test(data.attrValue.trim())
    ) {
      data.keepAttr = false
    }
  })
  const cleanBody = purifier.sanitize(body, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    ADD_ATTR: ['target', 'rel'],
    FORCE_BODY: true,
  })

  const heightScript = autoSize
    ? `<script>
function reportHeight() {
  var height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  if (height > 0) parent.postMessage({ __gardenMailFrameHeight: true, height: height }, "*");
}
reportHeight();
if (typeof ResizeObserver !== "undefined") new ResizeObserver(reportHeight).observe(document.body);
window.addEventListener("resize", reportHeight);
window.addEventListener("message", function (event) {
  if (event.source === parent && event.data === "__gardenMailMeasure") reportHeight();
});
setTimeout(reportHeight, 50);
setTimeout(reportHeight, 150);
setTimeout(reportHeight, 400);
</script>`
    : ''
  const padding = autoSize ? '0' : '16px'

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none';">
<style>
* { box-sizing: border-box; }
html { max-width: 100%; overflow-x: hidden; background: #fff; color-scheme: light; }
body {
  margin: 0;
  max-width: 100%;
  padding: ${padding};
  overflow-x: hidden;
  ${autoSize ? 'overflow: hidden;' : ''}
  overflow-wrap: anywhere;
  background: #fff;
  color: #1a1a1a;
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
[style*="position: fixed"], [style*="position:fixed"],
[style*="position: absolute"], [style*="position:absolute"] { position: relative !important; }
a { color: #2563eb; }
body > *, img, table, tbody, tr, td, th { max-width: 100% !important; }
img { height: auto; }
blockquote { margin-left: 0; border-left: 3px solid #d1d5db; padding-left: 1em; color: #6b7280; }
pre { overflow-x: auto; border-radius: 6px; background: #f3f4f6; padding: 12px; font-size: 13px; }
table { max-width: 100%; border-collapse: collapse; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { margin: 4px 0; padding-left: 20px; }
</style>
</head>
<body>${cleanBody}${heightScript}</body>
</html>`
}

/**
 * Sanitizes mail HTML, strips remote image requests, applies a strict CSP, and
 * isolates it in an opaque-origin iframe. Remote images previously allowed
 * tracking pixels to contact senders as soon as a message opened. Browser
 * detection uses `useSyncExternalStore`, so hydration is safe without the
 * banned `useEffect` lifecycle.
 */
export function MailHtmlFrame({
  body,
  title = 'Email content',
  className,
  autoSize = false,
}: {
  body: string
  title?: string
  className?: string
  autoSize?: boolean
}) {
  const inBrowser = useSyncExternalStore(
    subscribeToBrowser,
    () => true,
    () => false,
  )
  const heightStore = useMemo(makeFrameHeightStore, [])
  const height = useSyncExternalStore(
    heightStore.subscribe,
    heightStore.getSnapshot,
    () => 100,
  )
  const srcDoc = useMemo(
    () => (inBrowser ? buildEmailDocument(body, autoSize) : ''),
    [autoSize, body, inBrowser],
  )

  return (
    <iframe
      ref={heightStore.connect}
      className={className ?? 'block min-h-48 w-full border-0'}
      sandbox={
        autoSize
          ? 'allow-scripts allow-popups allow-top-navigation-by-user-activation'
          : 'allow-popups allow-top-navigation-by-user-activation'
      }
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={autoSize ? { height: `${height}px` } : undefined}
      scrolling={autoSize && height >= MAX_AUTO_FRAME_HEIGHT ? 'yes' : 'no'}
      title={title}
      onLoad={(event) =>
        event.currentTarget.contentWindow?.postMessage(
          '__gardenMailMeasure',
          '*',
        )
      }
    />
  )
}
