'use client'

import { useRef, useState, useEffect } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import {
  ContentEditor,
  type ContentEditorRef,
  useFileDropZone,
  FileDropOverlay,
} from '../../editor'
import { Button } from '@garden/ui/components/ui/button'
import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'
import { ActorAvatar } from '../../common/actor-avatar'
import { useFileUpload } from '@garden/core/hooks/use-file-upload'
import { api } from '@/lib/api'
import { cn } from '@garden/ui/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplyInputProps {
  issueId: string
  placeholder?: string
  avatarType: string
  avatarId: string
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>
  onCancel?: () => void
  size?: 'sm' | 'default'
  /** When true, bare Enter submits the reply (chat-style). Default true for replies. */
  submitOnEnter?: boolean
  autoFocus?: boolean
}

// ---------------------------------------------------------------------------
// ReplyInput
// ---------------------------------------------------------------------------

function ReplyInput({
  issueId,
  placeholder = 'Leave a reply...',
  avatarType,
  avatarId,
  onSubmit,
  onCancel,
  size = 'default',
  submitOnEnter = true,
  autoFocus = false,
}: ReplyInputProps) {
  const editorRef = useRef<ContentEditorRef>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const { uploadWithToast } = useFileUpload(api)
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((f) => editorRef.current?.uploadFile(f)),
  })

  useEffect(() => {
    const el = measureRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setIsExpanded(entry.contentRect.height > 32)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (autoFocus) {
      // Defer to next tick so the editor has mounted and is ready to focus.
      const id = requestAnimationFrame(() => editorRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [autoFocus])

  const handleUpload = async (file: File) => {
    const result = await uploadWithToast(file, { issueId })
    if (result) {
      setAttachmentIds((prev) => [...prev, result.id])
    }
    return result
  }

  const handleSubmit = async () => {
    const content = editorRef.current
      ?.getMarkdown()
      ?.replace(/(\n\s*)+$/, '')
      .trim()
    if (!content || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(
        content,
        attachmentIds.length > 0 ? attachmentIds : undefined,
      )
      editorRef.current?.clearContent()
      setIsEmpty(true)
      setAttachmentIds([])
    } finally {
      setSubmitting(false)
    }
  }

  const avatarSize = size === 'sm' ? 22 : 28

  return (
    <div className="group/editor flex items-start gap-2.5">
      <ActorAvatar
        actorType={avatarType}
        actorId={avatarId}
        size={avatarSize}
        className="mt-0.5 shrink-0"
      />
      <div
        {...dropZoneProps}
        className={cn(
          'relative min-w-0 flex-1 flex flex-col',
          size === 'sm' ? 'max-h-40' : 'max-h-56',
          isExpanded && 'pb-7',
        )}
      >
        <div className="flex-1 min-h-0 overflow-y-auto pr-14">
          <div ref={measureRef}>
            <ContentEditor
              ref={editorRef}
              placeholder={placeholder}
              onUpdate={(md) => setIsEmpty(!md.trim())}
              onSubmit={handleSubmit}
              onUploadFile={handleUpload}
              submitOnEnter={submitOnEnter}
              debounceMs={100}
            />
          </div>
        </div>
        <div className="absolute bottom-0 right-0 flex items-center gap-1 text-muted-foreground transition-colors group-focus-within/editor:text-foreground">
          <FileUploadButton
            size="sm"
            onSelect={(file) => editorRef.current?.uploadFile(file)}
          />
          {onCancel && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onCancel}
              className="px-1.5 text-[11px] text-muted-foreground"
            >
              Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={isEmpty || submitting}
            onClick={handleSubmit}
            className="size-6 rounded-full text-muted-foreground"
            aria-label={submitting ? 'Submitting reply' : 'Submit reply'}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        {isDragOver && <FileDropOverlay />}
      </div>
    </div>
  )
}

export { ReplyInput, type ReplyInputProps }
