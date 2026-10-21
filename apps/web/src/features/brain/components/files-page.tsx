import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Result } from 'better-result'
import { toast } from 'sonner'
import { FilePlus, Folder as FolderIcon, Plus, ArrowRight } from 'lucide-react'
import { FunnelSimple, PlugsConnected, CaretRight } from '@phosphor-icons/react'
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
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { BrainFileTypeIcon } from './file-type-icon'
import { BrainAllFilesView } from './all-files-view'
import { FileCardMenu, FileStatusChip, type FileRetryState } from './file-list'
import {
  addFileToBrainFolder,
  createBrainFolder,
  deleteBrainFile,
  deleteBrainFolder,
  removeFileFromBrainFolder,
  retryBrainFile,
  updateBrainFolder,
  uploadBrainFile,
  type BrainFileSummary,
} from '../api'
import {
  brainFileKeys,
  brainFileListOptions,
  brainFolderKeys,
  brainFolderListOptions,
} from '../queries'
import { BRAIN_ACCEPTED_FILE_TYPES, type BrainFolderSummary } from '../contract'
import { truncateMiddle } from '../format'
import { BrainFilePreviewDialog } from './file-preview-dialog'
import { BrainFileUploadDialog } from './file-upload-dialog'
import { BrainFolderDialog } from './folder-dialog'
import { BrainFolderCard } from './folder-card'
import { BrainFolderDetail } from './folder-detail'
import { PdfThumbnail } from './pdf-file-preview'
import { ViewModePill, type ViewMode } from './view-mode-pill'

type FolderScope = 'all' | 'private' | 'shared'

const FOLDER_TABS: readonly { id: FolderScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'private', label: 'Private' },
  { id: 'shared', label: 'Shared' },
]

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/**
 * One of the two most recent files beside the dropzone (Penpot top row shows
 * document preview cards next to the upload card): name strip over a rendered
 * thumbnail — page 1 of a ready PDF through the shared pdfjs cache, the type
 * glyph otherwise. This is the page's only file surface (the references carry
 * no separate Knowledge Base list), so a not-yet-ready file shows its indexing
 * status and retry action under the glyph instead of a bare fallback.
 */
function RecentFileCard({
  uploadedFile,
  folders,
  retry,
  onAddToFolder,
  onDelete,
  onPreview,
}: {
  uploadedFile: BrainFileSummary
  folders: readonly BrainFolderSummary[]
  retry: FileRetryState
  onAddToFolder: (file: BrainFileSummary, folderId: string) => void
  onDelete: (file: BrainFileSummary) => void
  onPreview: (file: BrainFileSummary) => void
}) {
  const canPreview = uploadedFile.status === 'ready'
  const isPdf = uploadedFile.name.toLowerCase().endsWith('.pdf')

  const glyph = (
    <span className="flex h-full items-center justify-center">
      <BrainFileTypeIcon fileName={uploadedFile.name} className="size-8" />
    </span>
  )

  return (
    <li className="w-full overflow-hidden rounded-xl bg-background-main-secondary sm:w-[15.5rem]">
      <div className="flex items-center gap-2 bg-border-default px-3 py-2">
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => onPreview(uploadedFile)}
          aria-label={`Preview ${uploadedFile.name}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left disabled:cursor-default"
        >
          <BrainFileTypeIcon fileName={uploadedFile.name} className="size-4" />
          <span
            className="min-w-0 truncate text-sm text-text-neutral-default"
            title={uploadedFile.name}
          >
            {truncateMiddle(uploadedFile.name, 36)}
          </span>
        </button>
        <FileCardMenu
          uploadedFile={uploadedFile}
          folders={folders}
          canPreview={canPreview}
          onPreview={onPreview}
          onAddToFolder={onAddToFolder}
          onDelete={onDelete}
        />
      </div>

      {canPreview ? (
        <button
          type="button"
          onClick={() => onPreview(uploadedFile)}
          aria-label={`Open preview of ${uploadedFile.name}`}
          className="block h-[7.25rem] w-full cursor-pointer overflow-hidden"
        >
          {isPdf ? (
            <PdfThumbnail fileId={uploadedFile.id} fallback={glyph} />
          ) : (
            glyph
          )}
        </button>
      ) : (
        // Not-ready body stays a plain container: the Retry control must not
        // sit inside a disabled preview button or its clicks get swallowed.
        <div className="flex h-[7.25rem] w-full flex-col items-center justify-center gap-1.5 px-2">
          <BrainFileTypeIcon fileName={uploadedFile.name} className="size-8" />
          <FileStatusChip file={uploadedFile} retry={retry} />
        </div>
      )}
    </li>
  )
}

/**
 * Files & Folders page (Penpot "Files & Folders [DEV READY]"): header band,
 * upload dropzone with the two most recent files beside it, and the Folders
 * section with All/Private/Shared scope tabs, grid/list toggle, and the
 * create-folder dialog. The design references carry no always-on file list,
 * so the recent-files row is the page's file surface; when more than two
 * files exist, a "View all N files" affordance on that row swaps the page to
 * the all-files view (the full list with search, table/grid, and per-file
 * actions). The file list query powers both (plus upload status polling), and
 * its load error surfaces under the top row. Folder selection swaps the
 * sections for the folder detail view.
 */
export function BrainFilesPage() {
  const wsId = useWorkspaceId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewFile, setPreviewFile] = useState<BrainFileSummary | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [sessionUploadIds, setSessionUploadIds] = useState<readonly string[]>(
    [],
  )
  const [folderScope, setFolderScope] = useState<FolderScope>('all')
  const [foldersView, setFoldersView] = useState<ViewMode>('grid')
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  /**
   * The main page shows only the two recents by design; when more files exist
   * a "View all N files" affordance swaps the page to the full-list view so
   * older files stay reachable (preview / delete / retry / add-to-folder).
   */
  const [allFilesOpen, setAllFilesOpen] = useState(false)
  const [folderDialog, setFolderDialog] = useState<{
    folder?: BrainFolderSummary
  } | null>(null)
  const [pendingDeleteFolder, setPendingDeleteFolder] =
    useState<BrainFolderSummary | null>(null)
  const [pendingDeleteFile, setPendingDeleteFile] =
    useState<BrainFileSummary | null>(null)
  /** Set when the upload was started from inside a folder detail view. */
  const uploadFolderIdRef = useRef<string | null>(null)
  /**
   * File attached in the create-folder dialog. Held in a ref because the
   * folder must exist before the upload-review flow can target it: the create
   * mutation's success handler picks this up and calls reviewFile with the new
   * folder id, reusing the standard upload → attach pipeline.
   */
  const folderDialogFileRef = useRef<File | null>(null)

  const queryClient = useQueryClient()
  const filesQuery = useQuery(brainFileListOptions(wsId, sessionUploadIds))
  /**
   * Newest upload first. The list route passes Helix's order straight through
   * (no ORDER BY), so recency is enforced here at the display layer — this one
   * sorted list feeds both the recent row and the all-files view. ISO strings
   * sort lexicographically; a missing timestamp (synthetic rows) sinks last.
   */
  const files = [...(filesQuery.data ?? [])].sort((a, b) =>
    (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''),
  )
  const sessionUploadIdSet = new Set(sessionUploadIds)
  /** The Penpot top row shows the two newest uploads beside the dropzone. */
  const recentFiles = files.slice(0, 2)

  const foldersQuery = useQuery(brainFolderListOptions(wsId))
  const folders = foldersQuery.data ?? []
  const visibleFolders =
    folderScope === 'all'
      ? folders
      : folders.filter((folder) => folder.privacy === folderScope)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadBrainFile(file, setUploadProgress),
    onMutate: () => setUploadProgress(0),
    onSuccess: async (uploadedFile) => {
      await queryClient.cancelQueries({
        queryKey: brainFileKeys.list(wsId),
        exact: true,
      })

      queryClient.setQueryData<BrainFileSummary[]>(
        brainFileKeys.list(wsId),
        (currentFiles = []) => [
          uploadedFile,
          ...currentFiles.filter((file) => file.id !== uploadedFile.id),
        ],
      )

      if (uploadedFile.status === 'processing') {
        setSessionUploadIds((currentIds) =>
          currentIds.includes(uploadedFile.id)
            ? currentIds
            : [...currentIds, uploadedFile.id],
        )

        void queryClient.invalidateQueries({
          queryKey: brainFileKeys.list(wsId),
          exact: true,
        })
      }

      // Toast before the attach step: an attach rejection escaping onSuccess
      // would flip the mutation to a misleading "upload failed" banner over
      // a file that IS safely uploaded.
      toast.success('A new file has been added', {
        description: truncateMiddle(uploadedFile.name, 56),
      })

      const folderId = uploadFolderIdRef.current
      uploadFolderIdRef.current = null
      if (folderId !== null) {
        const attachResult = await Result.tryPromise(() =>
          addFileToBrainFolder(folderId, uploadedFile.id),
        )
        attachResult.match({
          ok: (detail) => {
            queryClient.setQueryData(brainFolderKeys.detail(folderId), detail)
            void queryClient.invalidateQueries({
              queryKey: brainFolderKeys.list(wsId),
              exact: true,
            })
          },
          err: (error) =>
            toast.error(
              errorMessage(error, 'Could not add the file to the folder.'),
            ),
        })
      }
    },
    onSettled: () => {
      setUploadProgress(0)
      setSelectedFile(null)
    },
  })

  const retryMutation = useMutation({
    mutationFn: (id: string) => retryBrainFile(id),
    onSuccess: async (retriedFile) => {
      await queryClient.cancelQueries({
        queryKey: brainFileKeys.list(wsId),
        exact: true,
      })

      queryClient.setQueryData<BrainFileSummary[]>(
        brainFileKeys.list(wsId),
        (currentFiles = []) =>
          currentFiles.map((file) =>
            file.id === retriedFile.id ? retriedFile : file,
          ),
      )

      if (retriedFile.status === 'processing') {
        setSessionUploadIds((currentIds) =>
          currentIds.includes(retriedFile.id)
            ? currentIds
            : [...currentIds, retriedFile.id],
        )

        void queryClient.invalidateQueries({
          queryKey: brainFileKeys.list(wsId),
          exact: true,
        })
      }
    },
  })

  const deleteFileMutation = useMutation({
    mutationFn: (id: string) => deleteBrainFile(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<BrainFileSummary[]>(
        brainFileKeys.list(wsId),
        (currentFiles = []) => currentFiles.filter((file) => file.id !== id),
      )
      setPendingDeleteFile(null)
      toast.success('File deleted')
      void queryClient.invalidateQueries({ queryKey: brainFolderKeys.all })
    },
    onError: (error) => {
      toast.error(errorMessage(error, 'Could not delete the file.'))
    },
  })

  const createFolderMutation = useMutation({
    mutationFn: (input: { name: string; privacy: 'private' | 'shared' }) =>
      createBrainFolder(input),
    onSuccess: (folder) => {
      queryClient.setQueryData<BrainFolderSummary[]>(
        brainFolderKeys.list(wsId),
        (current = []) => [folder, ...current],
      )
      setFolderDialog(null)
      toast.success('A new folder has been created', {
        description: truncateMiddle(folder.name, 56),
      })

      const attachedFile = folderDialogFileRef.current
      folderDialogFileRef.current = null
      if (attachedFile !== null) reviewFile(attachedFile, folder.id)
    },
  })

  const updateFolderMutation = useMutation({
    mutationFn: (input: {
      id: string
      name?: string
      privacy?: 'private' | 'shared'
    }) =>
      // The id belongs in the URL, not the body: the route's strict update
      // schema rejects unknown keys, so forwarding `input` verbatim 400s.
      updateBrainFolder(input.id, { name: input.name, privacy: input.privacy }),
    onSuccess: (folder) => {
      queryClient.setQueryData<BrainFolderSummary[]>(
        brainFolderKeys.list(wsId),
        (current = []) =>
          current.map((entry) => (entry.id === folder.id ? folder : entry)),
      )
      queryClient.setQueryData(
        brainFolderKeys.detail(folder.id),
        (
          current:
            | { item: BrainFolderSummary; files: BrainFileSummary[] }
            | undefined,
        ) => (current ? { ...current, item: folder } : current),
      )
      setFolderDialog(null)
      toast.success('Folder updated', {
        description: truncateMiddle(folder.name, 56),
      })
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteBrainFolder(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<BrainFolderSummary[]>(
        brainFolderKeys.list(wsId),
        (current = []) => current.filter((entry) => entry.id !== id),
      )
      queryClient.removeQueries({ queryKey: brainFolderKeys.detail(id) })
      setPendingDeleteFolder(null)
      setActiveFolderId((current) => (current === id ? null : current))
      toast.success('Folder deleted')
    },
    onError: (error) => {
      toast.error(errorMessage(error, 'Could not delete the folder.'))
    },
  })

  const addToFolderMutation = useMutation({
    mutationFn: (input: { folderId: string; fileId: string }) =>
      addFileToBrainFolder(input.folderId, input.fileId),
    onSuccess: (detail) => {
      queryClient.setQueryData(brainFolderKeys.detail(detail.item.id), detail)
      void queryClient.invalidateQueries({
        queryKey: brainFolderKeys.list(wsId),
        exact: true,
      })
      toast.success('File added to folder', {
        description: truncateMiddle(detail.item.name, 56),
      })
    },
    onError: (error) => {
      toast.error(errorMessage(error, 'Could not add the file to the folder.'))
    },
  })

  const removeFromFolderMutation = useMutation({
    mutationFn: (input: { folderId: string; fileId: string }) =>
      removeFileFromBrainFolder(input.folderId, input.fileId),
    onSuccess: (detail) => {
      queryClient.setQueryData(brainFolderKeys.detail(detail.item.id), detail)
      void queryClient.invalidateQueries({
        queryKey: brainFolderKeys.list(wsId),
        exact: true,
      })
      toast.success('File removed from folder', {
        description: truncateMiddle(detail.item.name, 56),
      })
    },
    onError: (error) => {
      toast.error(
        errorMessage(error, 'Could not remove the file from the folder.'),
      )
    },
  })

  /**
   * Opens the review modal without starting the network upload.
   */
  const reviewFile = (
    file: File | undefined,
    folderId: string | null = null,
  ) => {
    if (file === undefined || uploadMutation.isPending) return
    uploadFolderIdRef.current = folderId
    setSelectedFile(file)
  }

  /**
   * Starts the upload after the user confirms the selected file.
   */
  const confirmUpload = () => {
    if (selectedFile === null || uploadMutation.isPending) return
    uploadMutation.mutate(selectedFile)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    reviewFile(file, uploadFolderIdRef.current)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    reviewFile(event.dataTransfer.files[0])
  }

  const openFilePicker = (folderId: string | null = null) => {
    uploadFolderIdRef.current = folderId
    fileInputRef.current?.click()
  }

  /**
   * Shared per-file retry state for every list surface (recent cards,
   * all-files view): polling only tracks files uploaded this session, and a
   * list error pauses it so a stalled file offers Retry instead of spinning.
   */
  const fileRetry: FileRetryState = {
    isPolling: (file) =>
      file.status === 'processing' &&
      sessionUploadIdSet.has(file.id) &&
      !filesQuery.isError,
    isRetrying: (file) =>
      retryMutation.isPending && retryMutation.variables === file.id,
    onRetry: (fileToRetry) => retryMutation.mutate(fileToRetry.id),
  }

  const uploadError =
    uploadMutation.error instanceof Error
      ? uploadMutation.error.message
      : uploadMutation.error
        ? 'The file could not be uploaded.'
        : null
  const retryError =
    retryMutation.error instanceof Error
      ? retryMutation.error.message
      : retryMutation.error
        ? 'The file could not be retried.'
        : null

  if (activeFolderId !== null) {
    return (
      <main className="h-full bg-background">
        <BrainFolderDetail
          folderId={activeFolderId}
          uploading={uploadMutation.isPending}
          onBack={() => setActiveFolderId(null)}
          onUploadFile={() => openFilePicker(activeFolderId)}
          onPreviewFile={setPreviewFile}
          onRemoveFile={(file) => {
            removeFromFolderMutation.mutate({
              folderId: activeFolderId,
              fileId: file.id,
            })
          }}
          onDeleteFolder={setPendingDeleteFolder}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={BRAIN_ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={handleFileChange}
          aria-label="Choose a document to upload"
        />

        {previewFile ? (
          <BrainFilePreviewDialog
            file={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        ) : null}

        <BrainFileUploadDialog
          file={selectedFile}
          uploading={uploadMutation.isPending}
          progress={uploadProgress}
          onConfirm={confirmUpload}
          onClose={() => setSelectedFile(null)}
        />

        {pendingDeleteFolder ? (
          <DeleteFolderDialog
            folder={pendingDeleteFolder}
            pending={deleteFolderMutation.isPending}
            onConfirm={() =>
              deleteFolderMutation.mutate(pendingDeleteFolder.id)
            }
            onClose={() => setPendingDeleteFolder(null)}
          />
        ) : null}
      </main>
    )
  }

  if (allFilesOpen) {
    return (
      <main className="h-full bg-background">
        <BrainAllFilesView
          files={files}
          folders={folders}
          uploading={uploadMutation.isPending}
          isListError={filesQuery.isError}
          isRefetchError={filesQuery.isRefetchError}
          isFetchingList={filesQuery.isFetching}
          onRetryList={() => void filesQuery.refetch()}
          onUploadFile={() => openFilePicker()}
          retry={fileRetry}
          onBack={() => setAllFilesOpen(false)}
          onPreview={setPreviewFile}
          onDelete={setPendingDeleteFile}
          onAddToFolder={(fileToAdd, folderId) =>
            addToFolderMutation.mutate({
              folderId,
              fileId: fileToAdd.id,
            })
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={BRAIN_ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={handleFileChange}
          aria-label="Choose a document to upload"
        />

        {previewFile ? (
          <BrainFilePreviewDialog
            file={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        ) : null}

        <BrainFileUploadDialog
          file={selectedFile}
          uploading={uploadMutation.isPending}
          progress={uploadProgress}
          onConfirm={confirmUpload}
          onClose={() => setSelectedFile(null)}
        />

        {pendingDeleteFile ? (
          <DeleteFileDialog
            file={pendingDeleteFile}
            pending={deleteFileMutation.isPending}
            onConfirm={() => deleteFileMutation.mutate(pendingDeleteFile.id)}
            onClose={() => setPendingDeleteFile(null)}
          />
        ) : null}
      </main>
    )
  }

  return (
    <main className="h-full overflow-y-auto bg-background">
      {/* Header band (design: white strip, 24px title + 16px subtitle) */}
      <header className="bg-background-main-default px-6 pt-12 pb-3">
        <div className="mx-auto w-full max-w-[80rem]">
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-text-neutral-default">
            Files &amp; Folders
          </h1>
          <p className="mt-0.5 text-base text-text-secondary">
            Keep all your documents organized, secure, and accessible in one
            place.
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-10 px-6 py-8">
        {/* Top row (design: 520×152 dashed dropzone + recent document cards) */}
        <section aria-label="Upload">
          <div className="flex flex-wrap items-start gap-4">
            {/* Clicking the dropzone opens the design's source menu (Add
                files / Use connector) instead of the picker directly; drag &
                drop still goes straight to review. Connector import has no
                backend, so that item stays visible but disabled. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    disabled={uploadMutation.isPending}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    className="flex h-[9.5rem] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-default bg-background-main-secondary text-center transition-colors hover:bg-background-main-secondary-hover disabled:cursor-wait disabled:opacity-70 sm:w-[32.5rem]"
                  />
                }
              >
                <FilePlus className="size-6 text-text-neutral-default" />

                <span className="flex flex-col gap-1">
                  <span className="text-sm text-text-neutral-default">
                    Add your documents or drag &amp; drop it here
                  </span>
                  <span className="text-sm text-text-secondary">
                    Sample docs include: docx, xlx, pdf, etc.
                  </span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={4}
                className="w-48"
              >
                <DropdownMenuItem onClick={() => openFilePicker()}>
                  <Plus className="size-4" />
                  Add files
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Not available yet">
                  <PlugsConnected className="size-4" weight="regular" />
                  Use connector
                  <CaretRight
                    className="ml-auto size-4"
                    weight="regular"
                    aria-hidden="true"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {recentFiles.length > 0 ? (
              <ul
                aria-label="Recent files"
                aria-live="polite"
                className="flex flex-wrap gap-4"
              >
                {recentFiles.map((file) => (
                  <RecentFileCard
                    key={file.id}
                    uploadedFile={file}
                    folders={folders}
                    retry={fileRetry}
                    onPreview={setPreviewFile}
                    onAddToFolder={(fileToAdd, folderId) =>
                      addToFolderMutation.mutate({
                        folderId,
                        fileId: fileToAdd.id,
                      })
                    }
                    onDelete={setPendingDeleteFile}
                  />
                ))}
              </ul>
            ) : null}

            {files.length > recentFiles.length ? (
              <Button
                variant="outline"
                className="h-10 gap-2 self-center"
                onClick={() => setAllFilesOpen(true)}
              >
                View all {files.length} files
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          {filesQuery.isError ? (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <p role="alert" className="text-text-danger-secondary">
                {filesQuery.isRefetchError
                  ? 'Could not refresh file statuses.'
                  : 'Could not load files.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={filesQuery.isFetching}
                onClick={() => void filesQuery.refetch()}
              >
                {filesQuery.isFetching ? 'Trying…' : 'Try again'}
              </Button>
            </div>
          ) : null}

          {uploadError ? (
            <p role="alert" className="mt-3 text-sm text-text-danger-secondary">
              {uploadError}
            </p>
          ) : null}
          {retryError ? (
            <p role="alert" className="mt-3 text-sm text-text-danger-secondary">
              {retryError}
            </p>
          ) : null}
        </section>

        {/* Folders section */}
        <section aria-label="Folders" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-text-neutral-default">
              Folders
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Folder scope"
                className="flex items-center gap-2"
              >
                {FOLDER_TABS.map((tab) => {
                  const active = folderScope === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFolderScope(tab.id)}
                      className={
                        active
                          ? 'h-8 cursor-pointer rounded-full border border-border-brand-secondary bg-background-brand-tertiary px-4 text-sm text-text-brand-secondary'
                          : 'h-8 cursor-pointer rounded-full border border-border-default bg-background-main-secondary px-4 text-sm text-text-neutral-default transition-colors hover:bg-background-main-secondary-hover'
                      }
                    >
                      {tab.label}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-4">
                {/* Design order: filter, view pill, create. Folder filtering
                    has no backend, so the funnel stays visible but disabled
                    per product decision. */}
                <Button
                  variant="outline"
                  size="icon-lg"
                  disabled
                  aria-label="Filter folders"
                  title="Filtering is not available yet"
                >
                  <FunnelSimple className="size-4" weight="regular" />
                </Button>

                <ViewModePill
                  mode={foldersView}
                  onChange={setFoldersView}
                  label="Folders"
                />

                <Button
                  className="h-10 gap-2"
                  onClick={() => setFolderDialog({})}
                >
                  <Plus className="size-4" />
                  Create a folder
                </Button>
              </div>
            </div>
          </div>

          {foldersQuery.isError ? (
            <div className="flex items-center gap-3 text-sm">
              <p role="alert" className="text-text-danger-secondary">
                Could not load folders.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={foldersQuery.isFetching}
                onClick={() => void foldersQuery.refetch()}
              >
                {foldersQuery.isFetching ? 'Trying…' : 'Try again'}
              </Button>
            </div>
          ) : visibleFolders.length === 0 ? (
            <div className="flex min-h-[18.5rem] flex-col items-center justify-center gap-4 rounded-xl bg-background-main-secondary px-6 text-center">
              <span className="flex size-12 items-center justify-center">
                <FolderIcon className="size-8 text-icon-neutral-tertiary" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-text-neutral-default">
                  No folders yet
                </p>
                <p className="text-sm text-text-secondary">
                  Create folders to store, share and collaborate on with your
                  team in chat
                </p>
              </div>
              <Button
                variant="outline"
                className="h-10 gap-2"
                onClick={() => setFolderDialog({})}
              >
                <Plus className="size-4" />
                Create a folder
              </Button>
            </div>
          ) : (
            <ul
              className={
                foldersView === 'list'
                  ? 'flex flex-col gap-3'
                  : 'flex flex-wrap gap-4'
              }
            >
              {visibleFolders.map((folder) => (
                <BrainFolderCard
                  key={folder.id}
                  folder={folder}
                  layout={foldersView}
                  onOpen={(entry) => setActiveFolderId(entry.id)}
                  onRename={(entry) => setFolderDialog({ folder: entry })}
                  onDelete={setPendingDeleteFolder}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={BRAIN_ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleFileChange}
        aria-label="Choose a document to upload"
      />

      {previewFile ? (
        <BrainFilePreviewDialog
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}

      <BrainFileUploadDialog
        file={selectedFile}
        uploading={uploadMutation.isPending}
        progress={uploadProgress}
        onConfirm={confirmUpload}
        onClose={() => setSelectedFile(null)}
      />

      {folderDialog ? (
        <BrainFolderDialog
          folder={folderDialog.folder ?? null}
          pending={
            createFolderMutation.isPending ||
            updateFolderMutation.isPending ||
            // reviewFile early-returns during an upload — block submit or the
            // dialog's attached file is silently discarded.
            uploadMutation.isPending
          }
          error={
            folderDialog.folder
              ? updateFolderMutation.error instanceof Error
                ? updateFolderMutation.error.message
                : null
              : createFolderMutation.error instanceof Error
                ? createFolderMutation.error.message
                : null
          }
          onSubmit={(input) => {
            if (folderDialog.folder) {
              updateFolderMutation.mutate({
                id: folderDialog.folder.id,
                name: input.name,
                // Send privacy only when flipped — resubmitting the stale
                // cached value could revert a teammate's concurrent change.
                ...(input.privacy !== folderDialog.folder.privacy
                  ? { privacy: input.privacy }
                  : {}),
              })
            } else {
              folderDialogFileRef.current = input.file ?? null
              createFolderMutation.mutate({
                name: input.name,
                privacy: input.privacy,
              })
            }
          }}
          onClose={() => {
            setFolderDialog(null)
            folderDialogFileRef.current = null
            createFolderMutation.reset()
            updateFolderMutation.reset()
          }}
        />
      ) : null}

      {pendingDeleteFolder ? (
        <DeleteFolderDialog
          folder={pendingDeleteFolder}
          pending={deleteFolderMutation.isPending}
          onConfirm={() => deleteFolderMutation.mutate(pendingDeleteFolder.id)}
          onClose={() => setPendingDeleteFolder(null)}
        />
      ) : null}

      {pendingDeleteFile ? (
        <DeleteFileDialog
          file={pendingDeleteFile}
          pending={deleteFileMutation.isPending}
          onConfirm={() => deleteFileMutation.mutate(pendingDeleteFile.id)}
          onClose={() => setPendingDeleteFile(null)}
        />
      ) : null}
    </main>
  )
}

/**
 * Shared confirm dialog for real file deletion (recent cards, all-files
 * view): unlike the folder-detach dialog this destroys the file, and the copy
 * says so.
 */
function DeleteFileDialog({
  file,
  pending,
  onConfirm,
  onClose,
}: {
  file: BrainFileSummary
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete file</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            Delete{' '}
            <span className="break-all" title={file.name}>
              {truncateMiddle(file.name, 64)}
            </span>
            ? This removes it from the knowledge base and any folders.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Shared confirm dialog for folder deletion from the card menu or detail. */
function DeleteFolderDialog({
  folder,
  pending,
  onConfirm,
  onClose,
}: {
  folder: BrainFolderSummary
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            Delete{' '}
            <span className="break-all" title={folder.name}>
              {truncateMiddle(folder.name, 64)}
            </span>
            ? The files inside stay in the knowledge base.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Delete folder
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
