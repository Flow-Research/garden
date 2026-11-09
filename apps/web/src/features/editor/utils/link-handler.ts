/**
 * Shared link handling utilities for the editor system.
 *
 * Used by content-editor (ProseMirror click handler), readonly-content
 * (react-markdown link component), and link-hover-card (Open button).
 */

/**
 * Open a link: internal paths go through the app router via `push` (from
 * `useNavigation`), external links open in a new tab.
 */
export function openLink(href: string, push: (path: string) => void): void {
  if (href.startsWith('/') && !href.startsWith('//')) {
    push(href)
  } else {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

/** Check if a href is a mention protocol link (should not be opened as a regular link). */
export function isMentionHref(href: string | null | undefined): href is string {
  return !!href && href.startsWith('mention://')
}
