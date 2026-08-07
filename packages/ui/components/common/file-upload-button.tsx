import { Paperclip } from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'

interface FileUploadButtonProps {
  /** Called with the selected file; upload ownership stays with the consumer. */
  onSelect: (file: File) => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'default'
}

/**
 * Uses the native label/input relationship so opening the file chooser needs no
 * imperative ref. Clearing before selection lets users choose the same file twice.
 */
function FileUploadButton({
  onSelect,
  disabled = false,
  className,
  size = 'default',
}: FileUploadButtonProps) {
  const dimensions =
    size === 'sm' ? 'size-6 [&_svg]:size-3.5' : 'size-7 [&_svg]:size-4'

  return (
    <label
      className={cn(
        'relative inline-flex cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        disabled && 'pointer-events-none opacity-50',
        dimensions,
        className,
      )}
      aria-disabled={disabled}
    >
      <Paperclip aria-hidden="true" />
      <span className="sr-only">Attach file</span>
      <input
        type="file"
        disabled={disabled}
        aria-label="Attach file"
        className="absolute inset-0 cursor-pointer opacity-0"
        onClick={(event) => {
          event.currentTarget.value = ''
        }}
        onChange={(event) => {
          const selected = event.currentTarget.files?.item(0)
          if (selected) onSelect(selected)
        }}
      />
    </label>
  )
}

export { FileUploadButton, type FileUploadButtonProps }
