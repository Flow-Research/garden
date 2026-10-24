import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Result } from 'better-result'
import { AlertTriangle, Download, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import {
  documentArtifactQueryKey,
  getDocumentArtifact,
} from '@/lib/api/documents'
import { WorkspaceDocsEditor } from './workspace-docs-editor'
import type { GardenCitationQuote } from './artifact-renderer'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'
import type * as PdfJs from 'pdfjs-dist'

type LoadedPdf = {
  pdfjs: typeof PdfJs
  pdf: PDFDocumentProxy
}

const PDF_ZOOM_MIN = 0.5
const PDF_ZOOM_MAX = 3.0
const PDF_ZOOM_STEP = 0.25

export type DocumentArtifactData = {
  kind: 'document'
  id?: string | null
  title?: string
  filename: string
  mediaType?: string | null
  url?: string | null
  content?: string | null
  versionId?: string | null
  versionNumber?: number | null
}

function isPreviewableUrl(data: DocumentArtifactData) {
  const media = data.mediaType ?? ''
  const name = data.filename.toLowerCase()
  return (
    Boolean(data.url) &&
    (media === 'application/pdf' ||
      media.startsWith('image/') ||
      name.endsWith('.pdf'))
  )
}

function isPdfArtifact(data: DocumentArtifactData) {
  const media = data.mediaType ?? ''
  return (
    media === 'application/pdf' || data.filename.toLowerCase().endsWith('.pdf')
  )
}

function isDocxArtifact(data: DocumentArtifactData) {
  return (
    data.mediaType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    data.filename.toLowerCase().endsWith('.docx')
  )
}

export function DocumentArtifact({
  chrome = true,
  data,
  quotes,
  refreshKey,
}: {
  chrome?: boolean
  data: DocumentArtifactData
  quotes?: GardenCitationQuote[]
  refreshKey?: number
}) {
  const versionNumber = data.versionNumber ?? null
  const canonicalDocx = isDocxArtifact(data) && Boolean(data.id)
  return (
    <div
      className={`flex ${chrome ? 'h-[420px]' : 'h-full'} flex-col bg-background`}
    >
      {chrome ? (
        <div className="flex items-center justify-end gap-2 py-2 px-3">
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-foreground">
              {data.filename}
            </span>
            {versionNumber && versionNumber > 0 && (
              <span className="shrink-0 inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                V{versionNumber}
              </span>
            )}
          </div>
          {data.url ? (
            <a
              href={data.url}
              download={data.filename}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <Download className="size-3.5" />
              {canonicalDocx ? 'Original DOCX' : 'Download'}
            </a>
          ) : null}
        </div>
      ) : null}
      {isPdfArtifact(data) ? (
        <PdfArtifactPreview
          filename={data.filename}
          quotes={quotes}
          refreshKey={refreshKey}
          url={data.url}
        />
      ) : isPreviewableUrl(data) ? (
        <iframe
          src={withRefreshKey(data.url, refreshKey)}
          title={data.filename}
          className="min-h-0 flex-1 border-0 bg-muted/60"
        />
      ) : isDocxArtifact(data) ? (
        data.id ? (
          <CanonicalDocxArtifact documentId={data.id} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 border-t border-border bg-muted/40 px-6 text-center">
            <AlertTriangle
              className="size-5 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Editable document unavailable
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              This attachment has no canonical document artifact.
            </p>
          </div>
        )
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 bg-muted/60 px-4 py-3 text-xs leading-relaxed text-foreground">
          {data.content || 'Preview not available for this document.'}
        </pre>
      )}
    </div>
  )
}

/**
 * Loads canonical state from Effect HttpApi. Source DOCX bytes are never a
 * rendering fallback because they do not contain canonical editor mutations.
 */
function CanonicalDocxArtifact({ documentId }: { documentId: string }) {
  const artifactQuery = useQuery({
    queryKey: documentArtifactQueryKey(documentId),
    queryFn: () => getDocumentArtifact(documentId),
    retry: false,
    staleTime: 60_000,
  })

  if (artifactQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 border-t border-border bg-muted/40 text-sm text-muted-foreground">
        <Spinner aria-hidden="true" />
        Loading editable document
      </div>
    )
  }

  if (artifactQuery.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-t border-border bg-muted/40 px-6 text-center">
        <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Editable document unavailable
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {artifactQuery.error.message}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void artifactQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <WorkspaceDocsEditor
      key={documentId}
      documentId={documentId}
      initialSnapshot={artifactQuery.data}
    />
  )
}

function withRefreshKey(url: string | null | undefined, refreshKey?: number) {
  if (!url || !refreshKey) return url ?? undefined
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}r=${refreshKey}`
}

function PdfArtifactPreview({
  filename,
  quotes,
  refreshKey,
  url,
}: {
  filename: string
  quotes?: GardenCitationQuote[]
  refreshKey?: number
  url?: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLElement[][]>([])
  // Each page wrapper, kept so the scroll-position observer can read offsets
  // and the page counter can stay in sync.
  const pageWrappersRef = useRef<HTMLDivElement[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [numPages, setNumPages] = useState(0)

  const [pdfDocument, setPdfDocument] = useState<LoadedPdf | null>(null)

  // Loading and rendering are separate so a zoom re-renders the loaded
  // document instead of downloading it again. Each owns its cleanup: the
  // document is destroyed when the URL changes or the preview unmounts (it
  // used to leak one per zoom step), and a superseded render stops after its
  // next await (it used to keep appending pages, duplicating them).
  useEffect(() => {
    setPdfDocument(null)
    if (!url) {
      setStatus('error')
      return
    }
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null
    setStatus('loading')
    const load = async () => {
      const result = await Result.tryPromise({
        try: async () => {
          const response = await fetch(withRefreshKey(url, refreshKey) ?? url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const bytes = await response.arrayBuffer()
          const pdfjs = await import('pdfjs-dist')
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url,
          ).toString()
          if (cancelled) return null
          const task = pdfjs.getDocument({ data: bytes })
          loadingTask = task
          return { pdfjs, pdf: await task.promise }
        },
        catch: () => new Error('PDF preview failed.'),
      })
      if (cancelled) return
      if (result.isErr() || !result.value) {
        setStatus('error')
        return
      }
      setPdfDocument(result.value)
    }
    void load()
    return () => {
      cancelled = true
      // Destroys the document too once it has loaded.
      void loadingTask?.destroy()
    }
  }, [url, refreshKey])

  useEffect(() => {
    if (!pdfDocument) return
    const { pdfjs, pdf } = pdfDocument
    let cancelled = false
    const renderTasks: RenderTask[] = []
    setStatus('loading')
    const render = async () => {
      const result = await Result.tryPromise({
        try: async () => {
          const container = containerRef.current
          if (!container) return
          const firstPage = await pdf.getPage(1)
          if (cancelled) return
          container.innerHTML = ''
          const naturalWidth = firstPage.getViewport({ scale: 1 }).width
          const availableWidth = Math.max(320, container.clientWidth - 20)
          const fitScale = Math.max(
            0.5,
            Math.min(1.5, availableWidth / naturalWidth),
          )
          const scale = fitScale * zoom
          const rendered: HTMLElement[][] = []
          const wrappers: HTMLDivElement[] = []

          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber)
            if (cancelled) return
            const viewport = page.getViewport({ scale })
            const wrapper = document.createElement('div')
            wrapper.className = 'relative mx-auto mb-2 w-fit bg-white shadow-md'

            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            canvas.style.display = 'block'
            wrapper.appendChild(canvas)

            const context = canvas.getContext('2d')
            if (!context) continue
            const renderTask = page.render({
              canvas,
              canvasContext: context,
              viewport,
            })
            renderTasks.push(renderTask)
            const renderResult = await Result.tryPromise({
              try: async () => {
                await renderTask.promise
              },
              catch: (error) =>
                error instanceof Error ? error : new Error(String(error)),
            })
            if (cancelled) return
            if (renderResult.isErr()) continue

            const textLayer = document.createElement('div')
            textLayer.className =
              'absolute inset-0 overflow-hidden text-transparent'
            textLayer.style.setProperty('--scale-factor', String(scale))
            wrapper.appendChild(textLayer)
            container.appendChild(wrapper)
            wrappers.push(wrapper)

            const layer = new pdfjs.TextLayer({
              container: textLayer,
              textContentSource: page.streamTextContent(),
              viewport,
            })
            await layer.render()
            if (cancelled) return
            rendered.push(
              Array.from(textLayer.querySelectorAll<HTMLElement>('span')),
            )
          }
          pagesRef.current = rendered
          pageWrappersRef.current = wrappers
          setNumPages(pdf.numPages)
          highlightPdfQuotes(rendered, scrollRef.current, quotes)
        },
        catch: () => new Error('PDF preview failed.'),
      })
      if (cancelled) return
      setStatus(result.isOk() ? 'ready' : 'error')
    }
    void render()
    return () => {
      cancelled = true
      for (const task of renderTasks) task.cancel()
    }
    // We intentionally exclude `quotes` from the deps — quote-only changes
    // are handled by the cheaper highlight-only effect below so a citation
    // hop doesn't re-render every page. `zoom` IS a dep because changing
    // the zoom requires a full re-render at the new scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDocument, zoom])

  useEffect(() => {
    if (status !== 'ready') return
    if (pagesRef.current.length === 0) return
    highlightPdfQuotes(pagesRef.current, scrollRef.current, quotes)
  }, [quotes, status])

  // Track the page whose center is closest to the viewport center so the page
  // counter remains reliable while users scroll through long PDFs.
  useEffect(() => {
    if (status !== 'ready') return
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const update = () => {
      const wrappers = pageWrappersRef.current
      if (wrappers.length === 0) return
      const center = scrollEl.scrollTop + scrollEl.clientHeight / 2
      let closest = 0
      let closestDist = Infinity
      wrappers.forEach((wrapper, index) => {
        const wrapperCenter = wrapper.offsetTop + wrapper.clientHeight / 2
        const dist = Math.abs(wrapperCenter - center)
        if (dist < closestDist) {
          closestDist = dist
          closest = index
        }
      })
      setCurrentPage(closest + 1)
    }
    update()
    scrollEl.addEventListener('scroll', update, { passive: true })
    return () => scrollEl.removeEventListener('scroll', update)
  }, [status])

  const handleZoomIn = () => {
    setZoom((current) =>
      Math.min(PDF_ZOOM_MAX, Math.round((current + PDF_ZOOM_STEP) * 100) / 100),
    )
  }
  const handleZoomOut = () => {
    setZoom((current) =>
      Math.max(PDF_ZOOM_MIN, Math.round((current - PDF_ZOOM_STEP) * 100) / 100),
    )
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden border-t border-border/60">
      {status === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted text-sm text-muted-foreground">
          Loading {filename}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted text-sm text-destructive">
          Preview not available for this document.
        </div>
      ) : null}
      <div ref={scrollRef} className="h-full overflow-auto bg-muted px-5 py-5">
        <div ref={containerRef} className="min-h-full" />
      </div>
      {status === 'ready' && numPages > 0 ? (
        <>
          <div className="pointer-events-none absolute bottom-4 left-4">
            <span className="flex items-center rounded-full border border-border bg-background-main-default/80 px-3 py-1.5 text-xs font-medium tabular-nums text-foreground shadow-md backdrop-blur-md">
              {currentPage}/{numPages}
            </span>
          </div>
          <div className="absolute bottom-4 right-4 flex items-center gap-px rounded-full border border-border bg-background-main-default/80 px-1 py-1 shadow-md backdrop-blur-md">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= PDF_ZOOM_MIN}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background-main-default disabled:opacity-30"
              aria-label="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="w-9 select-none text-center text-xs font-medium tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= PDF_ZOOM_MAX}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background-main-default disabled:opacity-30"
              aria-label="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

// Letters-only normalization — the most robust quote-match strategy across
// PDF span fragmentation. Strip punctuation, whitespace, and casing so a
// quote that spans a soft-hyphen, line break, or column break still matches.
function lettersOnly(value: string | null | undefined) {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

const PDF_HIGHLIGHT_MARKER = 'data-garden-pdf-highlight'

function clearPdfHighlights(pages: HTMLElement[][]) {
  for (const page of pages) {
    for (const span of page) {
      if (!span.hasAttribute(PDF_HIGHLIGHT_MARKER)) continue
      span.style.backgroundColor = ''
      span.style.color = ''
      span.removeAttribute(PDF_HIGHLIGHT_MARKER)
    }
  }
}

function highlightSpansForRange(
  spans: HTMLElement[],
  rangeStart: number,
  rangeEnd: number,
) {
  const hits: HTMLElement[] = []
  let cursor = 0
  for (const span of spans) {
    const stripped = lettersOnly(span.textContent)
    const spanStart = cursor
    const spanEnd = cursor + stripped.length
    cursor = spanEnd
    if (spanEnd <= rangeStart || spanStart >= rangeEnd) continue
    span.style.backgroundColor = 'rgba(250, 204, 21, 0.35)'
    span.style.color = 'transparent'
    span.setAttribute(PDF_HIGHLIGHT_MARKER, '1')
    hits.push(span)
  }
  return hits
}

function highlightPdfQuotes(
  pages: HTMLElement[][],
  scrollEl: HTMLElement | null,
  quotes: GardenCitationQuote[] | undefined,
) {
  // Always clear stale highlights before applying new ones — outline clicks
  // and citation hops swap quotes without a full re-render.
  clearPdfHighlights(pages)
  if (!quotes?.length || !scrollEl) return
  let firstMatch: HTMLElement | null = null
  // Build per-page concatenated stripped text once so segment lookups stay
  // O(pages) instead of O(spans*quotes).
  const stripped = pages.map((spans) =>
    spans.map((span) => lettersOnly(span.textContent)).join(''),
  )
  for (const quote of quotes) {
    // Split the quote on ellipsis variants so each segment can be located
    // independently — the model often emits "first phrase ... second phrase"
    // citations where the segments live on separate lines.
    const segments = quote.quote
      .split(/\.{3}|…/)
      .map((segment) => lettersOnly(segment))
      .filter((segment) => segment.length > 0)
    if (segments.length === 0) continue
    const hintedPage =
      typeof quote.page === 'number'
        ? quote.page
        : typeof quote.page === 'string'
          ? Number.parseInt(quote.page, 10)
          : null
    const pageOrder =
      hintedPage && Number.isFinite(hintedPage)
        ? [hintedPage - 1, ...pages.map((_, index) => index)]
        : pages.map((_, index) => index)
    let segmentMatched = false
    for (const segment of segments) {
      const probe = segment.slice(0, Math.min(60, segment.length))
      for (const pageIndex of pageOrder) {
        const pageText = stripped[pageIndex]
        if (!pageText) continue
        const matchPos = pageText.indexOf(probe)
        if (matchPos < 0) continue
        const hits = highlightSpansForRange(
          pages[pageIndex] ?? [],
          matchPos,
          matchPos + segment.length,
        )
        if (hits.length === 0) continue
        firstMatch ??= hits[0] ?? null
        segmentMatched = true
        break
      }
      if (segmentMatched && hintedPage) break
    }
  }
  if (!firstMatch) return
  const scrollRect = scrollEl.getBoundingClientRect()
  const targetRect = firstMatch.getBoundingClientRect()
  const top = targetRect.top - scrollRect.top + scrollEl.scrollTop - 80
  scrollEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}
