/**
 * Chat document subsystem.
 *
 * Extracted from `agent-interaction-screen.tsx` so the parent file stays
 * tractable. Owns three things:
 *
 *   1. **Inline file viewers** — `ImageLightbox` (fullscreen image carousel)
 *      and `DocumentViewerDialog` (modal for non-image files), used from
 *      `MessageFiles` when the user clicks an attachment.
 *   2. **Document side panel** — `DocumentSidePanel`, the resizable right-side
 *      pane that renders `GardenArtifact` for a chosen document or citation.
 *      Owns its own version selection / panel-width state.
 *   3. **File-kind helpers + types** that both this module and the chat
 *      screen rely on (`FileMessagePart`, `getFileKind`, `FileKindIcon`,
 *      `DocumentCitationAnnotation` and the `DocumentPanelView` union).
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Result } from 'better-result'
import { useQuery } from '@tanstack/react-query'
import {
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  X,
} from 'lucide-react'
import {
  getDocumentMetadata,
  listDocumentVersions,
  type DocumentMetadata,
  type DocumentVersionItem,
} from '@/lib/api'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { cn } from '@garden/ui/lib/utils'
import {
  GardenArtifact,
  type GardenArtifactData,
  type GardenCitationQuote,
} from '@/features/artifacts/artifact-renderer'
import type { ChatUiMessage } from '../chat-runtime-provider'

// ─── Shared types ────────────────────────────────────────────────────────────

export type FileMessagePart = Extract<
  ChatUiMessage['parts'][number],
  { type: 'file' }
>

export type DocumentCitationAnnotation = {
  document_id: string
  filename: string
  page?: number | string | null
  quote: string
  ref?: number | null
  version_id?: string | null
  version_number?: number | null
}

export type DocumentPanelDocumentView = {
  artifact: GardenArtifactData
  kind: 'document'
}

export type DocumentPanelCitationView = {
  artifact: GardenArtifactData
  citation: DocumentCitationAnnotation
  kind: 'citation'
}

export type DocumentPanelView =
  | DocumentPanelDocumentView
  | DocumentPanelCitationView

// ─── File-kind helpers ──────────────────────────────────────────────────────

export function isImageAttachment(file: FileMessagePart) {
  return file.mediaType?.startsWith('image/') ?? false
}

export function getFileKind(file: {
  mediaType?: string | null
  filename?: string | null
}): 'image' | 'pdf' | 'word' | 'csv' | 'json' | 'text' | 'other' {
  const media = file.mediaType ?? ''
  const name = (file.filename ?? '').toLowerCase()
  if (media.startsWith('image/')) return 'image'
  if (media === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (
    media === 'application/msword' ||
    media ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.doc') ||
    name.endsWith('.docx')
  ) {
    return 'word'
  }
  if (media === 'text/csv' || name.endsWith('.csv')) return 'csv'
  if (media === 'application/json' || name.endsWith('.json')) return 'json'
  if (
    media.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')
  ) {
    return 'text'
  }
  return 'other'
}

export function getFileKindLabel(kind: ReturnType<typeof getFileKind>) {
  switch (kind) {
    case 'image':
      return 'IMAGE'
    case 'pdf':
      return 'PDF'
    case 'word':
      return 'DOC'
    case 'csv':
      return 'CSV'
    case 'json':
      return 'JSON'
    case 'text':
      return 'TEXT'
    default:
      return 'FILE'
  }
}

export function FileKindIcon({
  kind,
  className,
}: {
  kind: ReturnType<typeof getFileKind>
  className?: string
}) {
  const common = cn('size-4 shrink-0 text-muted-foreground', className)
  switch (kind) {
    case 'pdf':
    case 'word':
    case 'text':
      return <FileText className={common} />
    case 'csv':
      return <FileSpreadsheet className={common} />
    case 'json':
      return <Braces className={common} />
    case 'image':
      return <FileIcon className={common} />
    default:
      return <Paperclip className={common} />
  }
}

// ─── Image lightbox ──────────────────────────────────────────────────────────

export function ImageLightbox({
  files,
  index,
  onClose,
  onChangeIndex,
}: {
  files: FileMessagePart[]
  index: number
  onClose: () => void
  onChangeIndex: (next: number) => void
}) {
  const file = files[index]

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft' && files.length > 1) {
        event.preventDefault()
        onChangeIndex((index - 1 + files.length) % files.length)
        return
      }
      if (event.key === 'ArrowRight' && files.length > 1) {
        event.preventDefault()
        onChangeIndex((index + 1) % files.length)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [files.length, index, onChangeIndex, onClose])

  if (!file) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 supports-backdrop-filter:backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={file.filename ?? 'Image preview'}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-background/20 p-2 text-white transition-colors hover:bg-background/40"
        aria-label="Close"
      >
        <X className="size-5" />
      </button>

      {files.length > 1 ? (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onChangeIndex((index - 1 + files.length) % files.length)
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-background/20 p-2 text-white transition-colors hover:bg-background/40"
            aria-label="Previous image"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onChangeIndex((index + 1) % files.length)
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-background/20 p-2 text-white transition-colors hover:bg-background/40"
            aria-label="Next image"
          >
            <ChevronRight className="size-6" />
          </button>
        </>
      ) : null}

      <img
        src={file.url}
        alt={file.filename ?? 'Attachment'}
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-background/20 px-4 py-1.5 text-xs text-white">
        <span className="truncate max-w-[60vw]">
          {file.filename ?? 'Image'}
        </span>
        {files.length > 1 ? (
          <span className="tabular-nums opacity-80">
            {index + 1} / {files.length}
          </span>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

// ─── Document viewer dialog ─────────────────────────────────────────────────

export function DocumentViewerDialog({
  file,
  onClose,
}: {
  file: FileMessagePart
  onClose: () => void
}) {
  const kind = getFileKind(file)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl! grid max-h-[85vh] grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl!"
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-center gap-3 border-b bg-muted/30 px-4 py-3">
          <FileKindIcon kind={kind} className="text-foreground/80" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">
              {file.filename ?? 'Document'}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {file.mediaType ?? 'Attached file'}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const anchor = document.createElement('a')
              anchor.href = file.url
              anchor.download = file.filename ?? 'attachment'
              document.body.appendChild(anchor)
              anchor.click()
              anchor.remove()
            }}
            aria-label="Download"
          >
            <Download className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <div className="min-h-0 overflow-auto bg-background">
          {kind === 'pdf' ? (
            <iframe
              src={file.url}
              title={file.filename ?? 'PDF document'}
              className="h-[70vh] w-full border-0"
            />
          ) : kind === 'text' || kind === 'json' || kind === 'csv' ? (
            <DocumentTextPreview file={file} kind={kind} />
          ) : (
            <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <FileKindIcon
                kind={kind}
                className="size-8 text-muted-foreground/60"
              />
              <p>Preview not available for this file type.</p>
              <a
                href={file.url}
                download={file.filename ?? 'attachment'}
                className="text-xs underline underline-offset-2 hover:text-foreground"
              >
                Download {file.filename ?? 'file'}
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DocumentTextPreview({
  file,
  kind,
}: {
  file: FileMessagePart
  kind: 'text' | 'json' | 'csv'
}) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Result.tryPromise(() =>
      fetch(file.url).then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.text()
      }),
    ).then((result) => {
      if (cancelled) return
      if (Result.isError(result)) {
        setError(
          result.error instanceof Error
            ? result.error.message
            : 'Failed to load document',
        )
        return
      }
      setContent(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [file.url])

  if (error) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 p-8 text-center text-sm">
        <p className="text-destructive">Failed to load document</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </div>
    )
  }

  const fontClass = kind === 'json' || kind === 'csv' ? 'font-mono' : ''

  return (
    <pre
      className={cn(
        'max-h-[72vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-xs leading-relaxed',
        fontClass,
      )}
    >
      {content}
    </pre>
  )
}

// ─── Document side panel ────────────────────────────────────────────────────

const DOCUMENT_PANEL_MIN_WIDTH = 300
const DOCUMENT_PANEL_MAX_OFFSET = 56

export function withDocumentVersionUrl(
  url: string | null | undefined,
  versionId: string | null | undefined,
) {
  if (!url || !versionId) return url ?? null
  const next = new URL(url, window.location.origin)
  next.searchParams.set('version_id', versionId)
  return `${next.pathname}${next.search}`
}

async function fetchDocumentVersions(documentId: string) {
  const payload = await listDocumentVersions(documentId)
  if (!payload.ok) throw new Error(payload.error ?? 'Failed to load versions')
  return {
    currentVersionId: payload.current_version_id ?? null,
    versions: payload.versions ?? [],
  }
}

async function fetchDocumentMetadata(
  documentId: string,
): Promise<DocumentMetadata | null> {
  const payload = await getDocumentMetadata(documentId)
  if (!payload.ok || !payload.metadata) return null
  return payload.metadata
}

export function expandCitationToQuotes(
  citation: DocumentCitationAnnotation,
): GardenCitationQuote[] {
  return citation.quote
    .split('[[PAGE_BREAK]]')
    .map((quote) => quote.trim())
    .filter(Boolean)
    .map((quote) => ({
      page: citation.page ?? null,
      quote,
    }))
}

/** Distinguishes immutable source bytes from the canonical editable artifact. */
function documentDownloadLabel(artifact: GardenArtifactData) {
  return isCanonicalDocxArtifact(artifact) ? 'Original DOCX' : 'Download'
}

function isCanonicalDocxArtifact(artifact: GardenArtifactData) {
  return Boolean(
    artifact.id && artifact.filename.toLowerCase().endsWith('.docx'),
  )
}

export function DocumentSidePanel({
  onClose,
  view,
}: {
  onClose: () => void
  view: DocumentPanelView | null
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(() =>
    typeof window !== 'undefined'
      ? Math.round((window.innerWidth - DOCUMENT_PANEL_MAX_OFFSET) / 2)
      : 600,
  )
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  )
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  const viewKey =
    view?.kind === 'citation'
      ? `${view.kind}:${view.citation.document_id}:${view.citation.ref ?? view.citation.quote}`
      : view
        ? `${view.kind}:${view.artifact.id ?? view.artifact.filename}`
        : 'none'

  useEffect(() => {
    setSelectedVersionId(null)
  }, [viewKey])

  const versionsQuery = useQuery({
    queryKey: ['document-versions', view?.artifact.id],
    queryFn: () => fetchDocumentVersions(view?.artifact.id ?? ''),
    enabled: Boolean(
      view?.artifact.id && !isCanonicalDocxArtifact(view.artifact),
    ),
    staleTime: 10_000,
  })

  const metadataQuery = useQuery({
    queryKey: ['document-metadata', view?.artifact.id],
    queryFn: () => fetchDocumentMetadata(view?.artifact.id ?? ''),
    enabled: Boolean(view?.artifact.id),
    staleTime: 60_000,
  })

  if (!view) return null

  const selectedVersion = versionsQuery.data?.versions.find(
    (version) => version.id === selectedVersionId,
  )
  const renderedArtifact: GardenArtifactData = selectedVersion
    ? {
        ...view.artifact,
        url: withDocumentVersionUrl(view.artifact.url, selectedVersion.id),
        versionId: selectedVersion.id,
        versionNumber:
          selectedVersion.version_number ?? view.artifact.versionNumber,
      }
    : view.artifact
  const artifactQuotes =
    view.kind === 'citation' ? expandCitationToQuotes(view.citation) : undefined

  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    dragStartX.current = event.clientX
    dragStartWidth.current = panelRef.current?.offsetWidth ?? panelWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = dragStartX.current - moveEvent.clientX
      const maxWidth =
        window.innerWidth - DOCUMENT_PANEL_MAX_OFFSET - DOCUMENT_PANEL_MIN_WIDTH
      setPanelWidth(
        Math.min(
          maxWidth,
          Math.max(DOCUMENT_PANEL_MIN_WIDTH, dragStartWidth.current + delta),
        ),
      )
    }
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      ref={panelRef}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-background shadow-[-4px_0_12px_rgba(0,0,0,0.02)]"
      style={{ width: panelWidth }}
    >
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-blue-400"
        style={{ marginLeft: -2 }}
      />

      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 z-20 shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Close panel"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col">
          {view.kind === 'citation' ? (
            <DocumentSidePanelCitationHeader
              artifact={renderedArtifact}
              citation={view.citation}
              selectedVersionId={selectedVersionId}
              versions={versionsQuery.data?.versions ?? []}
              onSelectVersion={setSelectedVersionId}
            />
          ) : (
            <DocumentSidePanelDocumentHeader
              artifact={renderedArtifact}
              metadata={metadataQuery.data ?? null}
              selectedVersionId={selectedVersionId}
              versions={versionsQuery.data?.versions ?? []}
              onSelectVersion={setSelectedVersionId}
            />
          )}
          <div className="min-h-0 flex-1 px-3 pb-3">
            <div className="h-full overflow-hidden">
              <GardenArtifact
                chrome={false}
                data={renderedArtifact}
                quotes={artifactQuotes}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DocumentSidePanelDocumentHeader({
  artifact,
  metadata,
  onSelectVersion,
  selectedVersionId,
  versions,
}: {
  artifact: GardenArtifactData
  metadata?: DocumentMetadata | null
  onSelectVersion?: (versionId: string | null) => void
  selectedVersionId?: string | null
  versions?: DocumentVersionItem[]
}) {
  const versionNumber = isCanonicalDocxArtifact(artifact)
    ? null
    : (artifact.versionNumber ?? null)
  const pageCount = metadata?.page_count ?? null
  return (
    <div className="flex items-center justify-end gap-2 px-3 py-2 pr-11">
      <div className="mr-auto flex min-w-0 items-center gap-2">
        <span className="truncate text-sm text-foreground/80">
          {artifact.filename}
        </span>
        {versionNumber && versionNumber > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 rounded-md text-xs text-muted-foreground"
          >
            V{versionNumber}
          </Badge>
        ) : null}
        {pageCount && pageCount > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 rounded-md text-xs text-muted-foreground"
          >
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </Badge>
        ) : null}
      </div>
      {versions &&
      versions.length > 1 &&
      onSelectVersion &&
      !isCanonicalDocxArtifact(artifact) ? (
        <DocumentVersionMenu
          selectedVersionId={selectedVersionId}
          versions={versions}
          onSelectVersion={onSelectVersion}
        />
      ) : null}
      {artifact.url ? (
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs text-muted-foreground"
          render={<a href={artifact.url} download={artifact.filename} />}
        >
          <Download />
          {documentDownloadLabel(artifact)}
        </Button>
      ) : null}
    </div>
  )
}

function DocumentSidePanelCitationHeader({
  artifact,
  citation,
  onSelectVersion,
  selectedVersionId,
  versions,
}: {
  artifact: GardenArtifactData
  citation: DocumentCitationAnnotation
  onSelectVersion?: (versionId: string | null) => void
  selectedVersionId?: string | null
  versions?: DocumentVersionItem[]
}) {
  const pageLabel =
    citation.page === null || citation.page === undefined
      ? null
      : `Page ${citation.page}`
  return (
    <div className="px-3 pb-3 pt-2 pr-11">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium text-foreground/80">Citation</p>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {versions &&
          versions.length > 1 &&
          onSelectVersion &&
          !isCanonicalDocxArtifact(artifact) ? (
            <DocumentVersionMenu
              selectedVersionId={selectedVersionId}
              versions={versions}
              onSelectVersion={onSelectVersion}
            />
          ) : null}
          {artifact.url ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs text-muted-foreground"
              render={<a href={artifact.url} download={artifact.filename} />}
            >
              <Download />
              {documentDownloadLabel(artifact)}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="w-full rounded-md border border-border bg-muted px-2 py-2">
        <p className="font-serif text-sm text-muted-foreground">
          &ldquo;{citation.quote.replaceAll('[[PAGE_BREAK]]', '...')}&rdquo;
          {pageLabel ? (
            <span className="ml-1 text-muted-foreground/60">({pageLabel})</span>
          ) : null}
        </p>
      </div>
    </div>
  )
}

function DocumentVersionMenu({
  selectedVersionId,
  versions,
  onSelectVersion,
}: {
  selectedVersionId?: string | null
  versions: DocumentVersionItem[]
  onSelectVersion: (versionId: string | null) => void
}) {
  const selected = versions.find((version) => version.id === selectedVersionId)
  const label =
    selected?.version_number && selected.version_number > 0
      ? `V${selected.version_number}`
      : 'Current'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Versions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSelectVersion(null)}>
          Current
        </DropdownMenuItem>
        {versions.map((version) => (
          <DropdownMenuItem
            key={version.id}
            onClick={() => onSelectVersion(version.id)}
          >
            <span className="truncate">
              {version.display_name?.trim() ||
                (version.version_number
                  ? `V${version.version_number}`
                  : 'Version')}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
