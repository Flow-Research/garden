import { useQuery } from '@tanstack/react-query'
import { PdfFilePreview } from './pdf-file-preview'
import { XlsxFilePreview } from './xlsx-file-preview'
import { Download, FileText, Loader2, X } from 'lucide-react'
import { Button, buttonVariants } from '@garden/ui/components/ui/button'
import { Markdown } from '@garden/ui/markdown'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import type { BrainFileSummary } from '../api'
import {
  brainFileExtractedTextOptions,
  brainFilePdfOptions,
  brainFileTextOptions,
} from '../queries'
import { timeAgo } from '@garden/core/format'
import { truncateMiddle } from '../format'

type PreviewKind = 'docx' | 'pdf' | 'text' | 'xlsx' | 'unavailable'

function previewKind(filename: string): PreviewKind {
  const normalizedName = filename.toLowerCase()

  if (normalizedName.endsWith('.pdf')) return 'pdf'
  if (normalizedName.endsWith('.docx')) return 'docx'
  if (normalizedName.endsWith('.xlsx')) return 'xlsx'
  if (normalizedName.endsWith('.md') || normalizedName.endsWith('.txt'))
    return 'text'

  return 'unavailable'
}

function getContentUrl(fileId: string, download = false) {
  const baseUrl = `/api/brain/files/${encodeURIComponent(fileId)}/content`
  return download ? `${baseUrl}?download` : baseUrl
}

function PreviewLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[65vh] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Loading preview...
    </div>
  )
}

function TextFilePreview({ fileId }: { fileId: string }) {
  const contentQuery = useQuery(brainFileTextOptions(fileId))

  if (contentQuery.isPending) return <PreviewLoading />

  if (contentQuery.isError) {
    return (
      <div className="flex min-h-[65vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          Could not load preview.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={contentQuery.isFetching}
          onClick={() => void contentQuery.refetch()}
        >
          {contentQuery.isFetching ? 'Trying...' : 'Try again'}
        </Button>
      </div>
    )
  }

  return (
    <pre className="min-h-[65vh] max-h-[65vh] overflow-auto whitespace-pre-wrap break-words bg-background px-6 py-5 font-mono text-sm leading-6 text-foreground">
      {contentQuery.data}
    </pre>
  )
}

function DocxFilePreview({ fileId }: { fileId: string }) {
  const contentQuery = useQuery(brainFileExtractedTextOptions(fileId))

  if (contentQuery.isPending) return <PreviewLoading />

  if (contentQuery.isError) {
    return (
      <div className="flex min-h-[65vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          Could not load preview.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={contentQuery.isFetching}
          onClick={() => void contentQuery.refetch()}
        >
          {contentQuery.isFetching ? 'Trying...' : 'Try again'}
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-[65vh] max-h-[65vh] overflow-auto bg-background px-8 py-6 text-foreground">
      <Markdown mode="full" className="mx-auto max-w-3xl">
        {contentQuery.data}
      </Markdown>
    </div>
  )
}

/**
 * Shows a workspace file through the authenticated Brain content route.
 * PDF, DOCX, XLSX, TXT, and MD files render inline. Other supported files keep
 * a clear download path when Garden cannot render them in the browser.
 *
 * Chrome follows the Penpot "View a File / Doc" modal (1235px): 24px title
 * with a "Made by … · age" meta line, a page count on the right for PDFs, and
 * a footer carrying the file info plus Cancel/Download. The design's footer
 * primary reads "Add to knowledge base", which does not apply to files that
 * already live in the brain, so Download keeps that slot.
 */
export function BrainFilePreviewDialog({
  file,
  onClose,
}: {
  file: BrainFileSummary
  onClose: () => void
}) {
  const downloadUrl = getContentUrl(file.id, true)
  const kind = previewKind(file.name)
  /**
   * Page count for the header's "12 pages" label. Shares the cached PDF.js
   * document query with PdfFilePreview, so this subscription never refetches;
   * `enabled` keeps non-PDF kinds from downloading bytes.
   */
  const pdfQuery = useQuery({
    ...brainFilePdfOptions(file.id),
    enabled: kind === 'pdf',
  })
  const pageCount = pdfQuery.data?.numPages
  const metaLine = [
    file.createdByName ? `Made by ${file.createdByName}` : null,
    file.uploadedAt ? timeAgo(file.uploadedAt, { absoluteAfterDays: 7 }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid max-h-[90vh] max-w-[1235px]! grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[1235px]!"
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-4 border-b px-8 py-4">
          <div className="min-w-0 flex-1">
            <DialogTitle
              className="truncate text-2xl font-semibold tracking-[-0.04em]"
              title={file.name}
            >
              {truncateMiddle(file.name, 60)}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              {metaLine === '' ? 'Workspace file' : metaLine}
            </DialogDescription>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {pageCount !== undefined ? (
              <span className="text-sm text-muted-foreground">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'}
              </span>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close preview"
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-auto bg-background-main-secondary">
          {kind === 'text' ? (
            <TextFilePreview fileId={file.id} />
          ) : kind === 'docx' ? (
            <DocxFilePreview fileId={file.id} />
          ) : kind === 'xlsx' ? (
            <XlsxFilePreview fileId={file.id} />
          ) : kind === 'pdf' ? (
            <PdfFilePreview fileId={file.id} />
          ) : (
            <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText
                className="size-10 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Preview unavailable
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Download this file to open it on your device.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t bg-background px-8 py-3">
          <div className="flex min-w-0 flex-col">
            <span
              className="truncate text-base font-semibold text-foreground"
              title={file.name}
            >
              {truncateMiddle(file.name, 48)}
            </span>
            {metaLine === '' ? null : (
              <span className="text-xs text-muted-foreground">{metaLine}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <a
              href={downloadUrl}
              download={file.name}
              className={buttonVariants({ variant: 'default' })}
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
