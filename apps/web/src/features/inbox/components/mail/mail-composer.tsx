// Composer shell adapts Cloudflare Agentic Inbox (Apache-2.0) and Zero (MIT).
// Pinned sources and notices: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { cn } from '@garden/ui/lib/utils'
import {
  Bold,
  FileText,
  Italic,
  Link,
  List,
  ListOrdered,
  Send,
  Trash2,
  Underline,
  X,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import type {
  MailAttachmentView,
  MailComposerFormat,
  MailComposerValues,
} from './types'

const formatActions: Array<{
  format: MailComposerFormat
  label: string
  icon: ReactNode
}> = [
  { format: 'bold', label: 'Bold', icon: <Bold /> },
  { format: 'italic', label: 'Italic', icon: <Italic /> },
  { format: 'underline', label: 'Underline', icon: <Underline /> },
  { format: 'bullet-list', label: 'Bulleted list', icon: <List /> },
  {
    format: 'ordered-list',
    label: 'Numbered list',
    icon: <ListOrdered />,
  },
  { format: 'link', label: 'Insert link', icon: <Link /> },
]

export type MailComposerProps = {
  variant: 'panel' | 'inline'
  values: MailComposerValues
  fromOptions?: Array<{ value: string; label: string }>
  attachments?: MailAttachmentView[]
  ccBccVisible: boolean
  sending?: boolean
  savingDraft?: boolean
  error?: string
  agentAttribution?: string
  approvalRequired?: boolean
  disabled?: boolean
  editor?: ReactNode
  onChange: (values: MailComposerValues) => void
  onToggleCcBcc: () => void
  onFormat?: (format: MailComposerFormat) => void
  onAttach?: (file: File) => void
  onRemoveAttachment?: (attachmentId: string) => void
  onSend: () => void
  onSaveDraft?: () => void
  onDiscard: () => void
  onClose?: () => void
}

/**
 * Controlled dock panel/inline composer. It copies the source field order and
 * action placement while leaving validation, autosave, and rich-editor state to
 * the owning feature. `editor` allows Garden's editor to replace the textarea.
 */
export function MailComposer({
  variant,
  values,
  fromOptions = [],
  attachments = [],
  ccBccVisible,
  sending = false,
  savingDraft = false,
  error,
  agentAttribution,
  approvalRequired = false,
  disabled = false,
  editor,
  onChange,
  onToggleCcBcc,
  onFormat,
  onAttach,
  onRemoveAttachment,
  onSend,
  onSaveDraft,
  onDiscard,
  onClose,
}: MailComposerProps) {
  const update = (field: keyof MailComposerValues, value: string) => {
    onChange({ ...values, [field]: value })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSend()
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden bg-background',
        variant === 'panel' ? 'h-full' : 'rounded-lg border shadow-sm',
      )}
    >
      <header
        className={cn(
          'flex shrink-0 items-center border-b px-3',
          variant === 'panel' ? 'h-11' : 'h-9 bg-muted/40',
        )}
      >
        <h2 className="text-sm font-medium">
          {variant === 'panel' ? 'New message' : 'Reply'}
        </h2>
        {agentAttribution ? (
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            {agentAttribution}
          </span>
        ) : null}
        <div className="flex-1" />
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close composer"
            onClick={onClose}
          >
            <X />
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-3 pt-3">
            <Alert variant="destructive">
              <AlertTitle>Message not sent</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        {approvalRequired ? (
          <div className="px-3 pt-3">
            <Alert>
              <AlertTitle>Approval required</AlertTitle>
              <AlertDescription>
                Review this agent-authored message before sending.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="divide-y px-3">
          <div className="flex min-h-10 items-center gap-2">
            <label
              htmlFor="mail-composer-to"
              className="w-10 text-xs text-muted-foreground"
            >
              To
            </label>
            <Input
              id="mail-composer-to"
              value={values.to}
              disabled={disabled}
              autoComplete="off"
              placeholder="name@company.com"
              onChange={(event) => update('to', event.target.value)}
              className="h-9 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={onToggleCcBcc}
              aria-expanded={ccBccVisible}
            >
              Cc/Bcc
            </Button>
          </div>

          {ccBccVisible ? (
            <>
              <div className="flex min-h-10 items-center gap-2">
                <label
                  htmlFor="mail-composer-cc"
                  className="w-10 text-xs text-muted-foreground"
                >
                  Cc
                </label>
                <Input
                  id="mail-composer-cc"
                  value={values.cc}
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(event) => update('cc', event.target.value)}
                  className="h-9 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="flex min-h-10 items-center gap-2">
                <label
                  htmlFor="mail-composer-bcc"
                  className="w-10 text-xs text-muted-foreground"
                >
                  Bcc
                </label>
                <Input
                  id="mail-composer-bcc"
                  value={values.bcc}
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(event) => update('bcc', event.target.value)}
                  className="h-9 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
                />
              </div>
            </>
          ) : null}

          <div className="flex min-h-10 items-center gap-2">
            <label
              htmlFor="mail-composer-subject"
              className="w-10 text-xs text-muted-foreground"
            >
              Subject
            </label>
            <Input
              id="mail-composer-subject"
              value={values.subject}
              disabled={disabled}
              onChange={(event) => update('subject', event.target.value)}
              className="h-9 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          {fromOptions.length > 0 ? (
            <div className="flex min-h-10 items-center gap-2">
              <label
                htmlFor="mail-composer-from"
                className="w-10 text-xs text-muted-foreground"
              >
                From
              </label>
              <select
                id="mail-composer-from"
                value={values.from}
                disabled={disabled}
                onChange={(event) => update('from', event.target.value)}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
              >
                {fromOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className={cn('px-3 py-2', variant === 'panel' && 'min-h-52')}>
          {editor ?? (
            <Textarea
              aria-label="Message body"
              value={values.body}
              disabled={disabled}
              placeholder="Write a message…"
              onChange={(event) => update('body', event.target.value)}
              className={cn(
                'resize-none border-0 px-0 shadow-none focus-visible:ring-0',
                variant === 'panel' ? 'min-h-48' : 'min-h-28',
              )}
            />
          )}
        </div>

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t px-3 py-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-sm"
              >
                <FileText className="size-4 shrink-0" />
                <span className="max-w-52 truncate">{attachment.filename}</span>
                <span className="text-xs text-muted-foreground">
                  {attachment.sizeLabel}
                </span>
                {onRemoveAttachment ? (
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.filename}`}
                    disabled={disabled}
                    onClick={() => onRemoveAttachment(attachment.id)}
                    className="rounded text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {onFormat ? (
        <div className="flex shrink-0 items-center gap-0.5 border-t px-3 py-1">
          {formatActions.map((action) => (
            <Button
              key={action.format}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={action.label}
              title={action.label}
              disabled={disabled}
              onClick={() => onFormat(action.format)}
            >
              {action.icon}
            </Button>
          ))}
        </div>
      ) : null}

      <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || sending}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDiscard}
        >
          <Trash2 />
          Discard
        </Button>
        {onAttach ? (
          <FileUploadButton
            size="default"
            disabled={disabled || sending}
            onSelect={onAttach}
          />
        ) : null}
        <div className="flex-1" />
        {onSaveDraft ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || savingDraft || sending}
            onClick={onSaveDraft}
          >
            {savingDraft ? 'Saving…' : 'Save draft'}
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={disabled || sending}>
          <Send />
          {sending
            ? 'Sending…'
            : approvalRequired
              ? 'Request approval'
              : 'Send'}
        </Button>
      </footer>
    </form>
  )
}
