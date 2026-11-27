import { useRef, useState, type DragEvent } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import {
  BRAIN_ACCEPTED_FILE_TYPES,
  BRAIN_FOLDER_NAME_MAX,
  type BrainFolderSummary,
} from '../contract'
import { truncateMiddle } from '../format'
import { BrainFileTypeIcon } from './file-type-icon'

type BrainFolderDialogProps = {
  /** When set, the dialog renames/reprivatizes this folder instead of creating. */
  folder?: BrainFolderSummary | null
  pending: boolean
  error: string | null
  onSubmit: (input: {
    name: string
    privacy: 'private' | 'shared'
    file?: File | null
  }) => void
  onClose: () => void
}

/**
 * Create/rename folder dialog from the Penpot "Create a folder" frame (512px,
 * radius 16): Folder Name field with an n/50 counter, a Make Private switch,
 * and — in create mode — the design's "Add file to folder" dropzone. The
 * footer's primary action stays disabled until the name is non-empty (the
 * design shows the disabled state explicitly).
 *
 * The design's Expiration field, AI-instructions copy, and "1 of 3" step
 * indicator are intentionally omitted: steps 2–3 are never drawn in Penpot and
 * the backend has no expiration/instruction concepts, so rendering them would
 * be dead UI. An attached file is handed to the page, which creates the folder
 * first and then routes the file through the standard upload-review flow
 * targeted at the new folder (see BrainFilesPage).
 */
export function BrainFolderDialog({
  folder,
  pending,
  error,
  onSubmit,
  onClose,
}: BrainFolderDialogProps) {
  const editing = folder != null
  const [name, setName] = useState(folder?.name ?? '')
  const [isPrivate, setIsPrivate] = useState(
    folder ? folder.privacy === 'private' : false,
  )
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !pending

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file !== undefined && !pending) setAttachedFile(file)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      {/* Design dialog is 512px wide. */}
      <DialogContent className="gap-6 rounded-2xl p-6 sm:max-w-[32rem]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold text-text-neutral-default">
            {editing ? 'Rename folder' : 'Create a folder'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing
              ? `Rename or change the privacy of ${folder.name}.`
              : 'Name the folder and choose who can see it.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            onSubmit({
              name: trimmedName,
              privacy: isPrivate ? 'private' : 'shared',
              file: editing ? null : attachedFile,
            })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="brain-folder-name"
                className="text-sm font-normal text-text-neutral-default"
              >
                Folder Name{' '}
                <span
                  aria-hidden="true"
                  className="text-text-danger-on-danger-secondary"
                >
                  *
                </span>
              </Label>
              <span className="text-xs text-text-neutral-secondary">
                {name.length}/{BRAIN_FOLDER_NAME_MAX}
              </span>
            </div>
            <Input
              id="brain-folder-name"
              value={name}
              maxLength={BRAIN_FOLDER_NAME_MAX}
              placeholder="Enter a folder name"
              autoFocus
              disabled={pending}
              onChange={(event) => setName(event.currentTarget.value)}
              className="h-10 rounded-lg border-border-default bg-background-main-secondary px-4 text-base placeholder:text-text-neutral-tertiary"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor="brain-folder-private"
                className="text-sm font-normal text-text-neutral-default"
              >
                Make Private
              </Label>
              <p className="text-sm text-text-neutral-tertiary">
                Set this folder to be private to you
              </p>
            </div>
            <Switch
              id="brain-folder-private"
              checked={isPrivate}
              disabled={pending}
              onCheckedChange={setIsPrivate}
            />
          </div>

          {!editing ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-normal text-text-neutral-default">
                Add file to folder
              </Label>

              {attachedFile === null ? (
                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  className="flex h-[9.5rem] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-background-main-secondary px-4 text-center"
                >
                  <span className="text-sm text-text-neutral-default">
                    Choose a file or drag &amp; drop it here
                  </span>
                  <span className="text-sm text-text-secondary">
                    PDF, DOCX, XLSX, TXT, MD formats, up to 100MB
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 h-8 gap-2"
                    disabled={pending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-3.5" />
                    Browse file
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border-default bg-background-main-secondary px-4 py-3">
                  <BrainFileTypeIcon
                    fileName={attachedFile.name}
                    className="size-5 shrink-0"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-text-neutral-default"
                    title={attachedFile.name}
                  >
                    {truncateMiddle(attachedFile.name, 48)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${attachedFile.name}`}
                    disabled={pending}
                    onClick={() => setAttachedFile(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept={BRAIN_ACCEPTED_FILE_TYPES}
                className="hidden"
                aria-label="Choose a file for the folder"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file !== undefined) setAttachedFile(file)
                }}
              />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-text-danger-secondary">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
              className="h-10 flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="h-10 flex-1">
              {pending
                ? editing
                  ? 'Saving…'
                  : 'Creating…'
                : editing
                  ? 'Save changes'
                  : 'Create folder'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
