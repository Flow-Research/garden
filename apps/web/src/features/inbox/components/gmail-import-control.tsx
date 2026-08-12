import { useState, type ReactNode } from 'react'
import { Check, Loader2, Mail, RotateCcw, Square } from 'lucide-react'
import { Alert, AlertDescription } from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@garden/ui/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import {
  selectedGmailImportAccount,
  type GmailImportAccountView,
  type GmailImportController,
} from '../gmail-import-controller'

function GmailIcon({
  src,
  className,
}: {
  src: string | null
  className: string
}) {
  return src ? (
    <img src={src} alt="" className={className} />
  ) : (
    <Mail className={className} aria-hidden="true" />
  )
}

/** Formats server-owned counters without deriving or estimating progress. */
function syncLabel(processed: number, total: number): string {
  return `Syncing ${processed.toLocaleString()} of ${total.toLocaleString()} emails`
}

/** Maps import state to the single compact action shown in Inbox chrome. */
function headerAction(controller: GmailImportController): {
  label: string
  disabled: boolean
  busy: boolean
} | null {
  const state = controller.state
  if (state.status === 'unavailable') return null
  if (state.status === 'checking') {
    return { label: 'Checking Google…', disabled: true, busy: true }
  }
  if (state.status === 'disconnected') {
    return { label: 'Connect Google', disabled: false, busy: false }
  }
  if (state.status === 'authorizing') {
    return { label: 'Waiting for Google…', disabled: true, busy: true }
  }
  if (state.status === 'scanning') {
    return { label: 'Scanning Gmail…', disabled: false, busy: true }
  }
  if (state.status === 'syncing') {
    return {
      label: syncLabel(state.processed, state.total),
      disabled: false,
      busy: true,
    }
  }
  if (state.status === 'cancelling') {
    return { label: 'Stopping import…', disabled: true, busy: true }
  }
  if (state.status === 'paused') {
    return { label: 'Resume import', disabled: false, busy: false }
  }
  if (state.status === 'failed') {
    return { label: 'Retry import', disabled: false, busy: false }
  }
  return { label: 'Import emails', disabled: false, busy: false }
}

/** Shows the exact Executor identity; multiple personal accounts stay explicit. */
function GmailAccountField({
  controller,
}: {
  controller: GmailImportController
}) {
  const account = selectedGmailImportAccount(controller)
  if (!account) return null

  const accountContent = (candidate: GmailImportAccountView): ReactNode => (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
        <GmailIcon
          src={candidate.iconUrl ?? controller.gmailIconUrl}
          className="size-4.5 object-contain"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {candidate.identityLabel}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-moss" />
          Connected · Personal
        </span>
      </span>
    </div>
  )

  if (controller.accounts.length === 1) {
    return (
      <div className="rounded-lg border border-border/60 p-2.5">
        {accountContent(account)}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        Gmail account
      </label>
      <Select
        value={account.connectionAddress}
        onValueChange={(value) => {
          if (value) controller.actions.selectAccount(value)
        }}
      >
        <SelectTrigger className="h-auto min-h-10 w-full py-2">
          <SelectValue>{accountContent(account)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {controller.accounts.map((candidate) => (
            <SelectItem
              key={candidate.connectionAddress}
              value={candidate.connectionAddress}
            >
              {candidate.identityLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Renders dialog content from the controller union; it owns no sync state. */
function GmailImportDialog({
  controller,
  open,
  onOpenChange,
}: {
  controller: GmailImportController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const state = controller.state
  const disconnected = state.status === 'disconnected'
  const authorizing = state.status === 'authorizing'
  const scanning = state.status === 'scanning'
  const syncing = state.status === 'syncing'
  const cancelling = state.status === 'cancelling'
  const paused = state.status === 'paused'
  const failed = state.status === 'failed'
  const complete = state.status === 'complete'
  const connected = state.status === 'connected' || complete
  const canImport = selectedGmailImportAccount(controller) !== null
  const progress =
    state.status === 'syncing' || state.status === 'paused'
      ? state
      : state.status === 'cancelling' && state.total !== null
        ? { processed: state.processed, total: state.total }
        : null

  let title = 'Import Gmail'
  let description =
    'Import existing mail into a read-only Garden mailbox. It will not appear as a sending address.'
  if (disconnected) {
    title = 'Connect Google'
    description =
      'Connect a personal Gmail account to import its mail into Garden.'
  } else if (authorizing) {
    title = 'Connect Google'
    description = 'Finish authorization in the Google window.'
  } else if (scanning || syncing || cancelling) {
    title = 'Importing Gmail'
    description =
      'Garden is importing in the background. You can safely close this window.'
  } else if (paused) {
    title = 'Gmail import paused'
    description =
      'Garden kept the exact mailbox workset and saved progress. Resume without scanning Gmail again.'
  } else if (complete) {
    title = 'Gmail imported'
    description = 'The imported mailbox is ready in Garden.'
  } else if (failed) {
    title = 'Gmail import needs attention'
    description =
      'Your imported mail is safe. Retry to continue from saved progress.'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted/40">
              <GmailIcon
                src={controller.gmailIconUrl}
                className="size-5 object-contain"
              />
            </span>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!disconnected && !authorizing ? (
          <GmailAccountField controller={controller} />
        ) : null}

        {authorizing ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-border/60 p-3 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" />
            Waiting for Google…
          </div>
        ) : null}

        {scanning ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-border/60 p-3 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" />
            Scanning Gmail…
          </div>
        ) : null}

        {progress ? (
          <Progress
            value={
              progress.total === 0
                ? 0
                : (progress.processed / progress.total) * 100
            }
            aria-label={syncLabel(progress.processed, progress.total)}
            aria-live="polite"
          >
            <ProgressLabel>
              {syncLabel(progress.processed, progress.total)}
            </ProgressLabel>
            <ProgressValue>
              {() =>
                progress.total === 0
                  ? '0%'
                  : `${Math.round((progress.processed / progress.total) * 100)}%`
              }
            </ProgressValue>
          </Progress>
        ) : null}

        {complete ? (
          <div className="flex items-start gap-2 rounded-lg border border-moss/25 bg-moss/5 p-3">
            <Check className="mt-0.5 size-4 shrink-0 text-moss" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {state.imported.toLocaleString()} emails imported
              </p>
              <p className="text-xs text-muted-foreground">
                {state.skipped > 0
                  ? `${state.skipped.toLocaleString()} already in Garden · `
                  : ''}
                {state.finishedAtLabel}
              </p>
            </div>
          </div>
        ) : null}

        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>
              {state.message}
              {state.total === null
                ? null
                : ` ${state.processed.toLocaleString()} of ${state.total.toLocaleString()} emails synced.`}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {disconnected || connected || failed || paused ? 'Cancel' : 'Close'}
          </Button>
          {scanning || syncing ? (
            <Button
              variant="destructive"
              onClick={controller.actions.cancelImport}
            >
              <Square className="fill-current" />
              Cancel import
            </Button>
          ) : null}
          {paused ? (
            <Button
              disabled={!canImport}
              onClick={controller.actions.resumeImport}
            >
              <RotateCcw />
              Resume import
            </Button>
          ) : null}
          {disconnected ? (
            <Button onClick={controller.actions.connect}>
              Continue with Google
            </Button>
          ) : null}
          {connected ? (
            <Button
              disabled={!canImport}
              onClick={controller.actions.startImport}
            >
              Import emails
            </Button>
          ) : null}
          {failed ? (
            <Button
              disabled={!canImport}
              onClick={controller.actions.retryImport}
            >
              <RotateCcw />
              Retry import
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Header action and modal for one injected, provider-backed import controller. */
export function GmailImportControl({
  controller,
}: {
  controller: GmailImportController
}) {
  const [open, setOpen] = useState(false)
  const action = headerAction(controller)
  if (!action) return null

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={action.disabled}
        onClick={() => setOpen(true)}
        className="max-w-72"
      >
        {action.busy ? (
          <Loader2 className="animate-spin" />
        ) : (
          <GmailIcon
            src={controller.gmailIconUrl}
            className="size-4 object-contain"
          />
        )}
        <span className="truncate tabular-nums">{action.label}</span>
      </Button>
      <GmailImportDialog
        controller={controller}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
