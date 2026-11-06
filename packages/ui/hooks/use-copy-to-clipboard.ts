import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copies text and reports `copied` for a moment afterwards. Shared by the
 * copy buttons, which each had their own copy: some showed "Copied" when the
 * write failed, some left its rejection unhandled, and none cleared their
 * reset timer.
 */
export function useCopyToClipboard(resetAfterMs = 2_000) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (timerRef.current) clearTimeout(timerRef.current)
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        setCopied(false)
        return false
      }
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), resetAfterMs)
      return true
    },
    [resetAfterMs],
  )

  return { copied, copy }
}
