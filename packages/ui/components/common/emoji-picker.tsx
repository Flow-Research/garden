import { useCallback } from 'react'
import data from '@emoji-mart/data'
import { Picker } from 'emoji-mart'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
}

/** Mounts the framework-agnostic emoji-mart element through a callback-ref lifecycle. */
export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const mountPicker = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container) return
      const picker = new Picker({
        data,
        theme: 'auto',
        set: 'native',
        previewPosition: 'none',
        skinTonePosition: 'search',
        maxFrequentRows: 2,
        onEmojiSelect: (emoji: { native: string }) => onSelect(emoji.native),
      })
      container.append(picker as unknown as string)
      return () => container.replaceChildren()
    },
    [onSelect],
  )

  return <div ref={mountPicker} />
}
