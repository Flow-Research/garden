import type { ReactNode } from 'react'
import {
  EllipsisVertical,
  Download,
  Eye,
  Folder as FolderIcon,
  FolderPlus,
  Loader2,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { brainFileDownloadUrl, type BrainFileSummary } from '../api'
import type { BrainFolderSummary } from '../contract'
import {
  formatFileSize,
  formatUploadedDate,
  formatUploadedTime,
  truncateMiddle,
} from '../format'
import { BrainFileTypeIcon } from './file-type-icon'

/**
 * Per-file retry state computed once by the page and shared by every list
 * surface (recent cards, all-files view). Function-valued so each row resolves
 * its own polling/retrying flags from the page's upload session + mutation.
 */
export type FileRetryState = {
  isPolling: (file: BrainFileSummary) => boolean
  isRetrying: (file: BrainFileSummary) => boolean
  onRetry: (file: BrainFileSummary) => void
}

/**
 * The honest ⋯ file menu: Download / Add to folder always; View file and
 * Delete file render only when their handlers are passed. Table rows in the
 * all-files view omit both because the design frame's Delete|View pills
 * already carry those actions beside the menu; surfaces without pills
 * (recent cards, grid cards) pass the handlers and keep the full menu. The
 * design also lists Edit and Add to knowledge base; neither maps to existing
 * behavior (no file rename API, and these files already live in the workspace
 * knowledge base), so they stay out per scope decision.
 */
export function FileCardMenu({
  uploadedFile,
  folders,
  canPreview = false,
  onPreview,
  onAddToFolder,
  onDelete,
}: {
  uploadedFile: BrainFileSummary
  folders: readonly BrainFolderSummary[]
  canPreview?: boolean
  onPreview?: (file: BrainFileSummary) => void
  onAddToFolder: (file: BrainFileSummary, folderId: string) => void
  onDelete?: (file: BrainFileSummary) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`File actions for ${uploadedFile.name}`}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-icon-neutral-default transition-colors hover:bg-background-main-secondary"
      >
        <EllipsisVertical className="size-4" />
      </DropdownMenuTrigger>
      {/* sideOffset drops the popup visibly below the trigger row so it
          doesn't sit flush against the Delete|View pills beside it. */}
      <DropdownMenuContent align="end" sideOffset={12} className="w-48">
        {onPreview ? (
          <DropdownMenuItem
            disabled={!canPreview}
            onClick={() => onPreview(uploadedFile)}
          >
            <Eye />
            View file
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            const anchor = document.createElement('a')
            anchor.href = brainFileDownloadUrl(uploadedFile)
            anchor.download = uploadedFile.name
            anchor.click()
          }}
        >
          <Download />
          Download
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={folders.length === 0}>
            <FolderPlus />
            Add to folder
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => onAddToFolder(uploadedFile, folder.id)}
              >
                <FolderIcon />
                <span className="min-w-0 truncate">{folder.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(uploadedFile)}
            >
              <Trash2 />
              Delete file
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Indexing status line for a not-ready file: spinner + Processing / Failed /
 * Retrying, plus a Retry action when indexing is stalled or failed. Renders
 * nothing for ready files so callers can drop it into any layout without
 * branching. The Retry control must stay outside disabled preview buttons —
 * nested interactive elements swallow its clicks.
 */
export function FileStatusChip({
  file,
  retry,
}: {
  file: BrainFileSummary
  retry: FileRetryState
}) {
  if (file.status === 'ready') return null

  const isPolling = retry.isPolling(file)
  const isRetrying = retry.isRetrying(file)
  const canRetry =
    file.status === 'failed' || (file.status === 'processing' && !isPolling)

  return (
    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
      {isPolling || isRetrying ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : null}
      {isRetrying
        ? 'Retrying'
        : file.status === 'failed'
          ? 'Failed'
          : 'Processing'}
      {canRetry ? (
        <button
          type="button"
          aria-label={`Retry ${file.name}`}
          disabled={isRetrying}
          onClick={() => retry.onRetry(file)}
          className="cursor-pointer font-medium text-text-neutral-default underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-70"
        >
          Retry
        </button>
      ) : null}
    </span>
  )
}

/**
 * The design's five-column file table (File name / Date uploaded / Time
 * uploaded / Size / Action), shared by the folder detail view and the
 * all-files view. Body rows separate columns with a vertical rule (left
 * border on every cell but the first); the gray header band stays unbroken
 * per product direction. Action-cell content is a slot: folder detail passes
 * its Delete|View pills, all-files passes pills plus the FileCardMenu. When
 * `retry` is provided, a not-ready file also shows its FileStatusChip under
 * the name — folder detail omits it (design has no status column there).
 */
export function FileListTable({
  files,
  search,
  retry,
  renderActions,
}: {
  files: readonly BrainFileSummary[]
  search: string
  retry?: FileRetryState
  renderActions: (file: BrainFileSummary) => ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-default">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="bg-background-main-secondary">
            <th className="px-6 py-4 text-center font-semibold text-text-neutral-default">
              File name
            </th>
            <th className="px-6 py-4 text-center font-semibold text-text-neutral-default">
              Date uploaded
            </th>
            <th className="px-6 py-4 text-center font-semibold text-text-neutral-default">
              Time uploaded
            </th>
            <th className="px-6 py-4 text-center font-semibold text-text-neutral-default">
              Size
            </th>
            <th className="px-6 py-4 text-center font-semibold text-text-neutral-default">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr
              key={file.id}
              className="border-t border-border-default bg-background-main-default"
            >
              <td className="px-6 py-5">
                {/* The name block (icon + name + status chip) centers as one
                    unit within its column, matching the design frame. */}
                <span className="flex min-w-0 flex-col items-center gap-1">
                  <span className="flex min-w-0 max-w-full items-center gap-2">
                    <BrainFileTypeIcon
                      fileName={file.name}
                      className="size-4.5 shrink-0"
                    />
                    <span
                      className="min-w-0 truncate text-text-neutral-default"
                      title={file.name}
                    >
                      {truncateMiddle(file.name, 44)}
                    </span>
                  </span>
                  {retry ? <FileStatusChip file={file} retry={retry} /> : null}
                </span>
              </td>
              <td className="border-l border-border-default px-6 py-5 text-center text-text-neutral-default">
                {formatUploadedDate(file.uploadedAt)}
              </td>
              <td className="border-l border-border-default px-6 py-5 text-center text-text-neutral-default">
                {formatUploadedTime(file.uploadedAt)}
              </td>
              <td className="border-l border-border-default px-6 py-5 text-center text-text-neutral-default">
                {formatFileSize(file.sizeBytes)}
              </td>
              <td className="border-l border-border-default px-6 py-5">
                <span className="flex items-center justify-center gap-2">
                  {renderActions(file)}
                </span>
              </td>
            </tr>
          ))}
          {files.length === 0 ? (
            <tr className="border-t border-border-default bg-background-main-default">
              <td
                colSpan={5}
                className="px-6 py-8 text-center text-text-secondary"
              >
                No files match “{search}”.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Grid-view card for one file, mirroring the KB card shape (name strip over
 * meta): the design shows the grid/list toggle but not the grid state, so the
 * card follows the established card language. The ⋯ menu is a slot — folder
 * detail passes its detach-honest menu, all-files passes FileCardMenu. With
 * `retry`, a not-ready file shows its FileStatusChip under the meta line.
 * (Extracted from folder-detail.tsx's FolderFileCard when the all-files view
 * became the second consumer.)
 */
export function FileGridCard({
  file,
  onPreview,
  menu,
  retry,
}: {
  file: BrainFileSummary
  onPreview: (file: BrainFileSummary) => void
  menu: ReactNode
  retry?: FileRetryState
}) {
  const canPreview = file.status === 'ready'

  return (
    <li className="w-full overflow-hidden rounded-xl bg-background-main-secondary sm:w-[15.5rem]">
      <div className="flex items-center gap-2 bg-border-default px-3 py-2">
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => onPreview(file)}
          aria-label={`Preview ${file.name}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left disabled:cursor-default"
        >
          <BrainFileTypeIcon fileName={file.name} className="size-4" />
          <span
            className="min-w-0 truncate text-sm text-text-neutral-default"
            title={file.name}
          >
            {truncateMiddle(file.name, 36)}
          </span>
        </button>
        {menu}
      </div>

      <div className="flex min-h-[5.5rem] flex-col justify-center gap-1 px-3 py-2.5">
        <p className="text-xs text-text-secondary">
          {formatUploadedDate(file.uploadedAt)}
          <span aria-hidden="true"> · </span>
          {formatFileSize(file.sizeBytes)}
        </p>
        {retry ? <FileStatusChip file={file} retry={retry} /> : null}
      </div>
    </li>
  )
}
