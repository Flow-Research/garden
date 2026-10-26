import { useCallback, type KeyboardEvent } from 'react'

/**
 * True when keystrokes on `target` are text input: form fields, and any
 * contentEditable region (Tiptap editors, the inbox reply box).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  return (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  )
}

/**
 * Returns a card-scoped key handler. Number keys 1–9 pick the matching option
 * while `enabled`. Keys typed into an editable element are left alone, so
 * typing "2" in a comment never answers a question. Held-down repeats and IME
 * composition are ignored too. `onSelect` receives the zero-based option
 * index.
 */
export function useOptionHotkeys({
  count,
  enabled,
  onSelect,
}: {
  count: number
  enabled: boolean
  onSelect: (index: number) => void
}): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled || count === 0) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.repeat || event.nativeEvent.isComposing) return
      if (isEditableTarget(event.target)) return
      const digit = Number.parseInt(event.key, 10)
      if (Number.isNaN(digit) || digit < 1 || digit > Math.min(count, 9)) {
        return
      }
      event.preventDefault()
      onSelect(digit - 1)
    },
    [count, enabled, onSelect],
  )
}
