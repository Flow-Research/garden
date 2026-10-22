import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Maximize2, Download, Link as LinkIcon, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { cn } from '@garden/ui/lib/utils'

// ---------------------------------------------------------------------------
// Lightbox — full-screen image preview (ESC or click backdrop to close).
// Built on Dialog so focus is trapped while it is open and restored after.
// ---------------------------------------------------------------------------

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-none"
        className="inset-0 top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 cursor-zoom-out items-center justify-center rounded-none bg-transparent p-0 ring-0 sm:max-w-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <DialogTitle className="sr-only">{alt || 'Image preview'}</DialogTitle>
        <img
          src={src}
          alt={alt}
          className="max-h-[90vh] max-w-[90vw] cursor-default rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Image NodeView — renders img with hover toolbar + lightbox
// ---------------------------------------------------------------------------

function ImageView({ node, editor, selected, deleteNode }: NodeViewProps) {
  const src = node.attrs.src as string
  const alt = (node.attrs.alt as string) || ''
  const title = node.attrs.title as string | undefined
  const uploading = node.attrs.uploading as boolean

  const [lightbox, setLightbox] = useState(false)
  const isEditable = editor.isEditable

  const handleView = () => setLightbox(true)

  const handleDownload = () => {
    // Cross-origin CDN images can't be fetched as blob (CORS),
    // and <a download> is ignored for cross-origin URLs.
    // Open in new tab — user can right-click → Save As.
    window.open(src, '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(src)
      toast.success('Link copied')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  return (
    <NodeViewWrapper className="image-node">
      <figure
        className={cn(
          'image-figure',
          selected && isEditable && 'image-selected',
        )}
        contentEditable={false}
        onClick={!isEditable && !uploading ? handleView : undefined}
      >
        <img
          src={src}
          alt={alt}
          title={title || undefined}
          className={cn('image-content', uploading && 'image-uploading')}
          draggable={false}
        />
        {!uploading && (
          <div
            className="image-toolbar"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={handleView} title="View image">
              <Maximize2 className="size-3.5" />
            </button>
            <button type="button" onClick={handleDownload} title="Download">
              <Download className="size-3.5" />
            </button>
            <button type="button" onClick={handleCopyLink} title="Copy link">
              <LinkIcon className="size-3.5" />
            </button>
            {isEditable && (
              <button type="button" onClick={() => deleteNode()} title="Delete">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </figure>
      {lightbox && (
        <ImageLightbox src={src} alt={alt} onClose={() => setLightbox(false)} />
      )}
    </NodeViewWrapper>
  )
}

export { ImageView, ImageLightbox }
