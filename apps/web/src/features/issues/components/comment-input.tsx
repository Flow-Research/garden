import { useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  ContentEditor,
  type ContentEditorRef,
  useFileDropZone,
  FileDropOverlay,
} from '../../editor'
import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'
import { toast } from 'sonner'
import {
  UPLOAD_IN_PROGRESS_MESSAGE,
  useAttachmentUpload,
} from '@/lib/hooks/use-attachment-upload'

interface CommentInputProps {
  issueId: string
  /** Resolves true when the comment was sent; the editor clears only then. */
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<boolean>
  placeholder?: string
  /** Adds a brand-tinted ring; used by the redirect mode of ContextualComposer. */
  accent?: 'default' | 'redirect'
}

function CommentInput({
  issueId,
  onSubmit,
  placeholder = 'Leave a comment...',
  accent = 'default',
}: CommentInputProps) {
  const editorRef = useRef<ContentEditorRef>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const { uploadWithToast } = useAttachmentUpload()
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((f) => editorRef.current?.uploadFile(f)),
  })

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
    // Sending now would drop the in-flight file and attach it to the next
    // message once it lands.
    if (editorRef.current?.hasActiveUploads()) {
      toast.info(UPLOAD_IN_PROGRESS_MESSAGE)
      return
    }
    setSubmitting(true)
    try {
      const sent = await onSubmit(
        content,
        attachmentIds.length > 0 ? attachmentIds : undefined,
      )
      if (!sent) return
      editorRef.current?.clearContent()
      setIsEmpty(true)
      setAttachmentIds([])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      {...dropZoneProps}
      className={
        accent === 'redirect'
          ? 'relative flex max-h-56 flex-col rounded-lg bg-card pb-8 ring-1 ring-brand/40'
          : 'relative flex max-h-56 flex-col rounded-lg bg-card pb-8 ring-1 ring-border'
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <ContentEditor
          ref={editorRef}
          placeholder={placeholder}
          onUpdate={(md) => setIsEmpty(!md.trim())}
          onSubmit={handleSubmit}
          onUploadFile={handleUpload}
          submitOnEnter
          debounceMs={100}
        />
      </div>
      <div className="absolute bottom-1 right-1.5 flex items-center gap-1">
        <FileUploadButton
          size="sm"
          onSelect={(file) => editorRef.current?.uploadFile(file)}
        />
        <Button
          aria-label={submitting ? 'Submitting comment' : 'Submit comment'}
          size="icon-sm"
          disabled={isEmpty || submitting}
          onClick={handleSubmit}
        >
          {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
      {isDragOver && <FileDropOverlay />}
    </div>
  )
}

export { CommentInput }
