import * as React from 'react'
import { Loader2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Optional icon shown beside the title. */
  media?: React.ReactNode
  confirmLabel: string
  /** Shown on the confirm button while `onConfirm` runs, e.g. "Deleting…". */
  pendingLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'destructive'
  /**
   * Runs the action. While it is pending both buttons are disabled and the
   * dialog cannot be dismissed, so the action cannot be sent twice. The
   * dialog closes when it resolves and stays open when it rejects, leaving
   * the caller's error message visible and the action retryable.
   */
  onConfirm: () => Promise<unknown> | void
}

/**
 * A confirmation step for destructive or external actions, with the pending
 * state built in. `AlertDialogAction` is a plain button that neither closes
 * the dialog nor disables itself, which left every hand-built confirm dialog
 * to get both right on its own.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  media,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false)

  const handleConfirm = async () => {
    if (pending) return
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // The caller reports the failure; stay open so it can be retried.
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          {media ? <AlertDialogMedia>{media}</AlertDialogMedia> : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => void handleConfirm()}
          >
            {/* Decorative: the label already says what is happening, and
                Spinner's role="status" would leak into the button's name. */}
            {pending ? (
              <Loader2Icon aria-hidden className="size-4 animate-spin" />
            ) : null}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
