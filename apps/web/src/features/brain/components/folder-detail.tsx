import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Database,
  DotsThreeVertical,
  Download,
  Eye,
  File as FileIcon,
  Folder as FolderIcon,
  Lock,
  Plus,
  ShareNetwork,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@garden/ui/components/ui/alert-dialog'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { Input } from '@garden/ui/components/ui/input'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { brainFileDownloadUrl, type BrainFileSummary } from '../api'
import type { BrainFolderSummary } from '../contract'
import { brainFolderDetailOptions } from '../queries'
import {
  csvFileNameCell,
  formatFileSize,
  formatUploadedDate,
  formatUploadedTime,
  truncateMiddle,
} from '../format'
import { FileGridCard, FileListTable } from './file-list'
import { ViewModePill, type ViewMode } from './view-mode-pill'

/**
 * Folder detail view (Penpot folder frame): breadcrumb back to Files &
 * Folders, folder title with brand folder glyph + privacy/count/size meta,
 * search + export toolbar with the shared grid/list pill, and the
 * five-column table (File name / Date uploaded / Time uploaded / Size /
 * Action) or a grid of KB-style file cards. The design's "Filter" control and
 * header copy icon are omitted by scope decision — no backend support or
 * defined behavior; the "Share" button renders disabled for the same reason.
 * The row/card action carries the design's "Delete" label even though it
 * detaches the file from the folder; the confirm dialog states honestly that
 * the file stays in the knowledge base.
 */
export function BrainFolderDetail({
  folderId,
  uploading,
  onBack,
  onUploadFile,
  onPreviewFile,
  onRemoveFile,
  onDeleteFolder,
}: {
  folderId: string
  uploading: boolean
  onBack: () => void
  onUploadFile: () => void
  onPreviewFile: (file: BrainFileSummary) => void
  onRemoveFile: (file: BrainFileSummary) => void
  onDeleteFolder: (folder: BrainFolderSummary) => void
}) {
  const detailQuery = useQuery(brainFolderDetailOptions(folderId))
  const detail = detailQuery.data
  const [search, setSearch] = useState('')
  /** Design default is the table; the pill flips to the card grid. */
  const [filesView, setFilesView] = useState<ViewMode>('list')
  const [pendingRemoveFile, setPendingRemoveFile] =
    useState<BrainFileSummary | null>(null)

  const visibleFiles = useMemo(() => {
    const files = detail?.files ?? []
    const query = search.trim().toLowerCase()
    if (query === '') return files
    return files.filter((file) => file.name.toLowerCase().includes(query))
  }, [detail?.files, search])

  const totalSize = useMemo(
    () =>
      (detail?.files ?? []).reduce(
        (sum, file) => sum + (file.sizeBytes ?? 0),
        0,
      ),
    [detail?.files],
  )

  const exportCsv = () => {
    if (!detail) return
    const header = 'File name,Date uploaded,Time uploaded,Size\n'
    const rows = detail.files
      .map((file) =>
        [
          csvFileNameCell(file.name),
          formatUploadedDate(file.uploadedAt),
          formatUploadedTime(file.uploadedAt),
          file.sizeBytes ?? '',
        ].join(','),
      )
      .join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${detail.item.name}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb band (design: "Files & Folders / {name}" on the strip) */}
      <div className="border-b border-border-default bg-background-main-default px-6 py-3">
        <div className="mx-auto flex w-full max-w-[80rem] items-center gap-2 text-sm">
          <button
            type="button"
            onClick={onBack}
            className="cursor-pointer text-text-secondary transition-colors hover:text-text-neutral-default"
          >
            Files &amp; Folders
          </button>
          <span aria-hidden="true" className="shrink-0 text-text-secondary">
            /
          </span>
          <span className="min-w-0 truncate text-text-neutral-default">
            {detail?.item.name ?? '…'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-6 px-6 py-8">
          {detailQuery.isPending ? (
            <FolderDetailSkeleton />
          ) : detailQuery.isError || !detail ? (
            <div className="flex items-center gap-3 text-sm">
              <p role="alert" className="text-text-danger-secondary">
                Could not load this folder.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={detailQuery.isFetching}
                onClick={() => void detailQuery.refetch()}
              >
                {detailQuery.isFetching ? 'Trying…' : 'Try again'}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="flex min-w-0 items-center gap-2.5 text-2xl font-semibold tracking-[-0.04em] text-text-neutral-default">
                    <FolderIcon
                      className="size-5 shrink-0 text-text-brand-secondary"
                      weight="fill"
                      aria-hidden="true"
                    />
                    <span className="truncate">{detail.item.name}</span>
                  </h2>
                  <p className="flex items-center gap-2 text-sm text-text-secondary">
                    {detail.item.privacy === 'private' ? (
                      <Lock
                        className="size-3.5"
                        weight="regular"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="capitalize">{detail.item.privacy}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {detail.item.fileCount}{' '}
                      {detail.item.fileCount === 1 ? 'file' : 'files'} (
                      {formatFileSize(totalSize)})
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label={`Delete folder ${detail.item.name}`}
                    onClick={() => onDeleteFolder(detail.item)}
                  >
                    <Trash className="size-4" weight="regular" />
                  </Button>
                  {/* Design frame order: delete, Share, Upload file. Folder
                      sharing has no backend, so Share stays visible but
                      disabled per product decision. */}
                  <Button
                    variant="outline"
                    className="h-10 gap-2"
                    disabled
                    title="Sharing is not available yet"
                  >
                    <ShareNetwork className="size-4" weight="regular" />
                    Share
                  </Button>
                  <Button
                    className="h-10 gap-2"
                    disabled={uploading}
                    onClick={onUploadFile}
                  >
                    <UploadSimple className="size-4" weight="regular" />
                    Upload file
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search for anything..."
                  aria-label="Search files in this folder"
                  className="h-8 w-full max-w-[21.25rem] rounded-lg border-transparent bg-background-main-secondary px-4 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2"
                  disabled={detail.files.length === 0}
                  onClick={exportCsv}
                >
                  <Database className="size-4" weight="regular" />
                  Export Data
                </Button>

                <div className="ml-auto">
                  <ViewModePill
                    mode={filesView}
                    onChange={setFilesView}
                    label="Folder files"
                  />
                </div>
              </div>

              {detail.files.length === 0 ? (
                <div className="flex min-h-[18.5rem] flex-col items-center justify-center gap-4 rounded-xl bg-background-main-secondary px-6 text-center">
                  <span className="flex size-12 items-center justify-center">
                    <FileIcon
                      className="size-8 text-icon-neutral-tertiary"
                      weight="regular"
                      aria-hidden="true"
                    />
                  </span>
                  <p className="text-sm text-text-neutral-default">
                    No files yet
                  </p>
                  <p className="text-sm text-text-secondary">
                    Upload files into the folder, share and collaborate on with
                    your team in chat
                  </p>
                  <Button
                    variant="outline"
                    className="h-10 gap-2"
                    disabled={uploading}
                    onClick={onUploadFile}
                  >
                    <Plus className="size-4" weight="regular" />
                    Browse file
                  </Button>
                </div>
              ) : filesView === 'grid' ? (
                <ul className="flex flex-wrap gap-4" aria-live="polite">
                  {visibleFiles.map((file) => (
                    <FileGridCard
                      key={file.id}
                      file={file}
                      onPreview={onPreviewFile}
                      menu={
                        <FolderFileMenu
                          file={file}
                          onPreview={onPreviewFile}
                          onDelete={setPendingRemoveFile}
                        />
                      }
                    />
                  ))}
                  {visibleFiles.length === 0 ? (
                    <li className="w-full rounded-xl bg-background-main-secondary px-6 py-8 text-center text-sm text-text-secondary">
                      No files match “{search}”.
                    </li>
                  ) : null}
                </ul>
              ) : (
                <FileListTable
                  files={visibleFiles}
                  search={search}
                  renderActions={(file) => (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => setPendingRemoveFile(file)}
                      >
                        <Trash className="size-3.5" weight="regular" />
                        Delete
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={file.status !== 'ready'}
                        onClick={() => onPreviewFile(file)}
                      >
                        <Eye className="size-3.5" weight="regular" />
                        View
                      </Button>
                    </>
                  )}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* The pill says "Delete" per design; the dialog keeps the promise
          honest — the file is detached, not destroyed. */}
      {pendingRemoveFile ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingRemoveFile(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete file from folder</AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                Remove{' '}
                <span className="break-all" title={pendingRemoveFile.name}>
                  {truncateMiddle(pendingRemoveFile.name, 64)}
                </span>
                ? The file stays in your knowledge base.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  onRemoveFile(pendingRemoveFile)
                  setPendingRemoveFile(null)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

/**
 * The ⋯ menu for a folder-detail file card (the card shell is the shared
 * FileGridCard): View file / Download / Delete (detach — same confirm dialog
 * as the table pill).
 */
function FolderFileMenu({
  file,
  onPreview,
  onDelete,
}: {
  file: BrainFileSummary
  onPreview: (file: BrainFileSummary) => void
  onDelete: (file: BrainFileSummary) => void
}) {
  const canPreview = file.status === 'ready'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`File actions for ${file.name}`}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-icon-neutral-default transition-colors hover:bg-background-main-secondary-hover"
      >
        <DotsThreeVertical className="size-4" weight="regular" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          disabled={!canPreview}
          onClick={() => onPreview(file)}
        >
          <Eye className="size-4" weight="regular" />
          View file
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const anchor = document.createElement('a')
            anchor.href = brainFileDownloadUrl(file)
            anchor.download = file.name
            anchor.click()
          }}
        >
          <Download className="size-4" weight="regular" />
          Download
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(file)}>
          <Trash className="size-4" weight="regular" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FolderDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      aria-busy="true"
      aria-label="Loading folder"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  )
}
