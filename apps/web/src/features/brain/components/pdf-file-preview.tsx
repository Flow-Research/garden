import { useCallback, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { brainFilePdfOptions } from '../queries'

function PdfLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[65vh] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Spinner aria-hidden="true" />
      Loading preview...
    </div>
  )
}

/**
 * Draws one PDF page when its canvas enters the React tree.
 * The callback ref also cancels unfinished rendering when React removes it.
 */
function PdfPageCanvas({
  fileId,
  pageNumber,
  pdf,
  thumbnail = false,
  thumbnailScale = 0.2,
}: {
  fileId: string
  pageNumber: number
  pdf: PDFDocumentProxy
  thumbnail?: boolean
  /** Render scale for thumbnails; the rail uses 0.2, wider cards need more. */
  thumbnailScale?: number
}) {
  const [renderFailed, setRenderFailed] = useState(false)
  const pageQuery = useQuery({
    queryKey: ['brain', 'files', fileId, 'pdf', 'page', pageNumber] as const,
    queryFn: () => pdf.getPage(pageNumber),
    staleTime: Infinity,
  })

  const renderCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !pageQuery.data) return

      const page: PDFPageProxy = pageQuery.data
      const scale = thumbnail ? thumbnailScale : 1
      const viewport = page.getViewport({ scale })
      const context = canvas.getContext('2d')

      if (!context) return

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
      })

      void renderTask.promise.catch((cause: unknown) => {
        if (
          cause instanceof Error &&
          cause.name === 'RenderingCancelledException'
        ) {
          return
        }
        setRenderFailed(true)
      })

      return () => renderTask.cancel()
    },
    [pageQuery.data, thumbnail, thumbnailScale],
  )

  if (pageQuery.isPending) {
    return (
      <div
        role="status"
        className={
          thumbnail
            ? 'flex aspect-[3/4] w-full items-center justify-center bg-muted'
            : 'flex min-h-96 w-full items-center justify-center bg-white'
        }
      >
        <Spinner className="text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading page {pageNumber}</span>
      </div>
    )
  }

  if (pageQuery.isError || renderFailed) {
    return (
      <div
        role="alert"
        className="flex min-h-24 items-center justify-center bg-muted px-2 text-center text-xs text-destructive"
      >
        Could not render page {pageNumber}.
      </div>
    )
  }

  return (
    <canvas
      ref={renderCanvas}
      role={thumbnail ? undefined : 'img'}
      aria-hidden={thumbnail || undefined}
      aria-label={thumbnail ? undefined : `PDF page ${pageNumber}`}
      className={
        thumbnail
          ? 'h-auto w-full bg-white'
          : 'mx-auto h-auto max-w-full bg-white shadow-md'
      }
    />
  )
}

/**
 * Shows one PDF with page thumbnails and explicit page navigation.
 * PDF pages reuse the cached document and page queries. Layout follows the
 * Penpot preview modal body: a 210px thumbnail rail on the design's #d9d9d9
 * surface (the border-default token, matching the file-card header strip) and
 * the page on the #f5f5f5 background-main-secondary surface.
 */
export function PdfFilePreview({ fileId }: { fileId: string }) {
  const [selectedPage, setSelectedPage] = useState(1)
  const pdfQuery = useQuery(brainFilePdfOptions(fileId))

  if (pdfQuery.isPending) return <PdfLoading />

  if (pdfQuery.isError) {
    return (
      <div className="flex min-h-[65vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          Could not load PDF preview.
        </p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pdfQuery.isFetching}
          onClick={() => void pdfQuery.refetch()}
        >
          {pdfQuery.isFetching ? 'Trying...' : 'Try again'}
        </Button>
      </div>
    )
  }

  const pdf = pdfQuery.data
  const pageNumbers = Array.from(
    { length: pdf.numPages },
    (_, index) => index + 1,
  )

  return (
    <div className="grid h-[65vh] grid-cols-[13.125rem_minmax(0,1fr)]">
      <nav
        aria-label="PDF pages"
        className="overflow-y-auto bg-border-default px-4 py-3"
      >
        <div className="flex flex-col gap-2">
          {pageNumbers.map((pageNumber) => {
            const selected = pageNumber === selectedPage

            return (
              <button
                key={pageNumber}
                type="button"
                aria-label={`Show page ${pageNumber}`}
                aria-current={selected ? 'page' : undefined}
                onClick={() => setSelectedPage(pageNumber)}
                className={`cursor-pointer rounded-md border p-1 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background hover:bg-muted'
                }`}
              >
                <PdfPageCanvas
                  fileId={fileId}
                  pageNumber={pageNumber}
                  pdf={pdf}
                  thumbnail
                />

                <span className="mt-1 block text-center text-[0.625rem] text-muted-foreground">
                  Page {pageNumber}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      <div className="flex min-h-0 flex-col bg-background-main-secondary">
        <div className="border-b border-border-default bg-background-main-default px-4 py-2 text-center text-xs text-muted-foreground">
          Page {selectedPage} of {pdf.numPages}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          <PdfPageCanvas
            key={selectedPage}
            fileId={fileId}
            pageNumber={selectedPage}
            pdf={pdf}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Page-1 document thumbnail for the Files page recent-file cards (Penpot top
 * row shows rendered document previews beside the dropzone). Reuses the cached
 * PDF.js document query; while loading or on failure it renders `fallback`
 * instead of the rail's spinner/error chrome, because a decorative card should
 * degrade quietly to the caller's type glyph. Scale 0.45 keeps an A4 page
 * sharp at the 15.5rem card width (the rail's 0.2 would upscale blurry).
 */
export function PdfThumbnail({
  fileId,
  fallback,
}: {
  fileId: string
  fallback: ReactNode
}) {
  const pdfQuery = useQuery(brainFilePdfOptions(fileId))

  if (!pdfQuery.data) return <>{fallback}</>

  return (
    <PdfPageCanvas
      fileId={fileId}
      pageNumber={1}
      pdf={pdfQuery.data}
      thumbnail
      thumbnailScale={0.45}
    />
  )
}
