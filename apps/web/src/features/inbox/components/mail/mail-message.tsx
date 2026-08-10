// Thread message composition directly adapts Zero (MIT) and Cloudflare Agentic Inbox (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Forward,
  Pencil,
  Reply,
  ReplyAll,
  Send,
  Trash2,
} from 'lucide-react'
import { MailAvatar } from './mail-avatar'
import { MailHtmlFrame } from './mail-html-frame'
import type { MailAttachmentView, MailMessageView } from './types'

function addressLabel(message: MailMessageView): string {
  const recipients = message.to
    .map((address) => address.name || address.address)
    .join(', ')
  return `to ${recipients}`
}

function MailAttachments({
  attachments,
  onOpen,
}: {
  attachments: MailAttachmentView[]
  onOpen?: (attachment: MailAttachmentView) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 border-t px-4 py-3">
      {attachments.map((attachment) => {
        const content = (
          <>
            <FileText className="size-4 shrink-0" />
            <span className="max-w-48 truncate">{attachment.filename}</span>
            <span className="text-xs text-muted-foreground">
              {attachment.sizeLabel}
            </span>
            <Download className="ml-1 size-3.5 shrink-0" />
          </>
        )

        return attachment.downloadUrl ? (
          <a
            key={attachment.id}
            href={attachment.downloadUrl}
            download={attachment.filename}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </a>
        ) : (
          <button
            key={attachment.id}
            type="button"
            disabled={!onOpen}
            onClick={() => onOpen?.(attachment)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}

export type MailMessageProps = {
  message: MailMessageView
  expanded: boolean
  onToggleExpanded: () => void
  onReply?: () => void
  onReplyAll?: () => void
  onForward?: () => void
  onSendDraft?: () => void
  onEditDraft?: () => void
  onDiscardDraft?: () => void
  onOpenAttachment?: (attachment: MailAttachmentView) => void
}

/**
 * Controlled collapsible message. Drafts keep Cloudflare's explicit colored
 * rail and actions; expanded messages end with Zero's reply action group.
 */
export function MailMessage({
  message,
  expanded,
  onToggleExpanded,
  onReply,
  onReplyAll,
  onForward,
  onSendDraft,
  onEditDraft,
  onDiscardDraft,
  onOpenAttachment,
}: MailMessageProps) {
  const isDraft = message.status === 'draft'

  return (
    <article
      className={cn(
        'overflow-hidden rounded-lg border bg-background',
        isDraft && 'border-l-4 border-l-warning',
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggleExpanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <MailAvatar people={[message.from]} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">
              {message.from.name || message.from.address}
            </span>
            {isDraft ? (
              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                Draft
              </span>
            ) : null}
            {message.agentAuthored ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {message.authorLabel || 'Agent-authored'}
              </span>
            ) : null}
            <time className="ml-auto shrink-0 text-xs text-muted-foreground">
              {message.sentAtLabel}
            </time>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {addressLabel(message)}
          </span>
          {!expanded && message.textPreview ? (
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {message.textPreview}
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded ? (
        <div className="border-t">
          <MailHtmlFrame
            body={message.html}
            title={`Message from ${message.from.name || message.from.address}`}
            className="block h-72 min-h-48 w-full border-0"
          />
          <MailAttachments
            attachments={message.attachments ?? []}
            onOpen={onOpenAttachment}
          />
          <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3">
            {isDraft ? (
              <>
                {onSendDraft ? (
                  <Button size="sm" onClick={onSendDraft}>
                    <Send />
                    Send
                  </Button>
                ) : null}
                {onEditDraft ? (
                  <Button variant="outline" size="sm" onClick={onEditDraft}>
                    <Pencil />
                    Edit
                  </Button>
                ) : null}
                {onDiscardDraft ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={onDiscardDraft}
                  >
                    <Trash2 />
                    Discard
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                {onReply ? (
                  <Button variant="outline" size="sm" onClick={onReply}>
                    <Reply />
                    Reply
                  </Button>
                ) : null}
                {onReplyAll ? (
                  <Button variant="outline" size="sm" onClick={onReplyAll}>
                    <ReplyAll />
                    Reply all
                  </Button>
                ) : null}
                {onForward ? (
                  <Button variant="outline" size="sm" onClick={onForward}>
                    <Forward />
                    Forward
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}
