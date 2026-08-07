import { forwardRef, useImperativeHandle, useRef } from 'react'
import { cn } from '@garden/ui/lib/utils'

interface TitleEditorProps {
  defaultValue?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
  onSubmit?: () => void
  onBlur?: (value: string) => void
  onChange?: (value: string) => void
}

interface TitleEditorRef {
  getText: () => string
  focus: () => void
}

/**
 * A title is plain single-line text, so a native input provides the complete
 * contract without mounting a ProseMirror document or synchronizing editor state.
 */
const TitleEditor = forwardRef<TitleEditorRef, TitleEditorProps>(
  function TitleEditor(
    {
      defaultValue = '',
      placeholder = '',
      className,
      autoFocus = false,
      onSubmit,
      onBlur,
      onChange,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      getText: () => inputRef.current?.value ?? '',
      focus: () => {
        inputRef.current?.focus()
        const end = inputRef.current?.value.length ?? 0
        inputRef.current?.setSelectionRange(end, end)
      },
    }))

    return (
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder || 'Title'}
        className={cn(
          'w-full border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground',
          className,
        )}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        onBlur={(event) => onBlur?.(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSubmit?.()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.currentTarget.blur()
          }
        }}
      />
    )
  },
)

export { TitleEditor, type TitleEditorProps, type TitleEditorRef }
