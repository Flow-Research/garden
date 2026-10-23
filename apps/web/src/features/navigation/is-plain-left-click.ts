type ClickModifiers = Pick<
  MouseEvent,
  'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
>

/**
 * True for an unmodified primary-button click, the only kind a link should
 * handle in-app. Cmd/Ctrl/Shift/Alt and middle clicks mean "new tab",
 * "new window" or "download", so those must reach the browser.
 */
export function isPlainLeftClick(event: ClickModifiers) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}
