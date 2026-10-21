import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { BrainFileTypeIcon } from './file-type-icon'
import { truncateMiddle } from '../format'

type BrainFileUploadDialogProps = {
  file: File | null
  onClose: () => void
  onConfirm: () => void
  progress: number
  uploading: boolean
}

/**
 * Lets the user review a selected file before upload. After confirmation, the
 * same modal shows byte-level upload progress. Width follows the Penpot
 * "Uploading your file" dialog (479px, radius 12 — the DialogContent default).
 */
export function BrainFileUploadDialog({
  file,
  onClose,
  onConfirm,
  progress,
  uploading,
}: BrainFileUploadDialogProps) {
  if (file === null) return null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !uploading) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!uploading}
        className="gap-5 p-5 sm:max-w-[479px]"
      >
        <DialogHeader>
          <DialogTitle>
            {uploading ? 'Uploading your file' : 'Add to knowledge base'}
          </DialogTitle>

          <DialogDescription className="sr-only">
            {uploading
              ? `Garden is uploading ${file.name}.`
              : `Review ${file.name} before adding it to the knowledge base.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4">
          <BrainFileTypeIcon fileName={file.name} />

          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-medium text-foreground"
              title={file.name}
            >
              {truncateMiddle(file.name, 48)}
            </p>

            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {uploading ? (
                <>
                  <Spinner className="size-3" aria-hidden="true" />
                  Uploading file
                </>
              ) : (
                'Ready to upload'
              )}
            </p>

            {uploading ? (
              <div className="mt-4 flex items-center gap-3">
                <span
                  role="progressbar"
                  aria-label={`Uploading ${file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
                >
                  <span
                    className="block h-full rounded-full bg-foreground transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                </span>

                <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                  {progress}%
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {!uploading ? (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <Button type="button" onClick={onConfirm}>
              Add to knowledge base
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
