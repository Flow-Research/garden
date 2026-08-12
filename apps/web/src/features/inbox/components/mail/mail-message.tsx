// Direct adaptation of Cloudflare Agentic Inbox's ThreadMessage (Apache-2.0).
// Pinned source and notice: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Forward,
  Pencil,
  Reply,
  ReplyAll,
  Send,
  Trash2,
} from 'lucide-react'
import { MailHtmlFrame } from './mail-html-frame'
import type { MailAttachmentView, MailMessageView } from './types'

function addressLabel(message: MailMessageView): string {
  return message.to.map((address) => address.name || address.address).join(', ')
}

/**
 * Renders Cloudflare's compact attachment treatment after message content.
 * Garden previously placed attachments in a separate bordered footer, which
 * made each thread entry read as a card instead of one continuous thread.
 */
function MailAttachments({
  attachments,
  onOpen,
}: {
  attachments: MailAttachmentView[]
  onOpen?: (attachment: MailAttachmentView) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2 md:ml-[42px]">
      {attachments.map((attachment) => {
        const className =
          'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted'
        const content = (
          <>
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[140px] truncate font-medium">
              {attachment.filename}
            </span>
            <span className="text-muted-foreground">
              {attachment.sizeLabel}
            </span>
          </>
        )

        return attachment.downloadUrl ? (
          <a
            key={attachment.id}
            href={attachment.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
          >
            {content}
          </a>
        ) : (
          <button
            key={attachment.id}
            type="button"
            disabled={!onOpen}
            onClick={() => onOpen?.(attachment)}
            className={className}
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
  isLast?: boolean
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
 * Controlled port of Cloudflare Agentic Inbox's flat ThreadMessage. Normal
 * messages are separated only by a line; drafts add the source's exact 2px
 * warning rail and 2% warning tint. Zero's reply actions remain available
 * without restoring Garden's former per-message card chrome.
 */
export function MailMessage({
  message,
  expanded,
  isLast = true,
  onToggleExpanded,
  onReply,
  onReplyAll,
  onForward,
  onSendDraft,
  onEditDraft,
  onDiscardDraft,
  onOpenAttachment,
}: MailMessageProps) {
  const isDraft = message.status === 'draft' || message.status === 'failed'
  const isSending = message.draftStatus === 'sending'
  const isAwaitingApproval = message.draftStatus === 'awaiting_approval'
  const senderLabel = isDraft
    ? 'Draft reply'
    : message.from.name || message.from.address
  const containerClassName = cn(
    !isLast && 'border-b',
    isDraft && 'border-l-2 border-l-warning bg-warning/[0.02]',
  )
  const avatarLabel = isDraft
    ? 'D'
    : (message.from.name || message.from.address).charAt(0).toUpperCase()

  const avatar = (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        isDraft ? 'bg-muted text-muted-foreground' : 'bg-muted text-foreground',
      )}
    >
      {avatarLabel}
    </div>
  )

  if (!expanded) {
    return (
      <article className={containerClassName}>
        <button
          type="button"
          aria-expanded={false}
          onClick={onToggleExpanded}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {avatar}
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between">
              <span className="truncate text-sm font-medium">
                {senderLabel}
              </span>
              <time className="shrink-0 text-xs text-muted-foreground">
                {message.sentAtLabel}
              </time>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {message.textPreview}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </article>
    )
  }

  return (
    <article className={cn('group/thread-message', containerClassName)}>
      <div className="px-4 py-4 md:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-label="Collapse message"
              className="shrink-0 rounded-full outline-none hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {avatar}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {senderLabel}
                </span>
                {isDraft ? (
                  <Badge variant="outline">
                    {isAwaitingApproval ? 'Approval requested' : 'Draft'}
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                To: {addressLabel(message)}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <time className="text-xs text-muted-foreground">
              {message.sentAtLabel}
            </time>
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-label="Collapse message"
              className="ml-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronUp className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="md:ml-[42px]">
          <MailHtmlFrame
            body={message.html}
            title={`Message from ${message.from.name || message.from.address}`}
            autoSize
            className="block min-h-[100px] w-full border-0"
          />
        </div>

        {isDraft && (onSendDraft || onEditDraft || onDiscardDraft) ? (
          <div className="mt-3 flex gap-2 md:ml-[42px]">
            {onSendDraft ? (
              <Button size="sm" onClick={onSendDraft} disabled={isSending}>
                <Send />
                {isSending
                  ? 'Sending...'
                  : isAwaitingApproval
                    ? 'Approve & send'
                    : 'Send'}
              </Button>
            ) : null}
            {onEditDraft ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onEditDraft}
                disabled={isSending}
              >
                <Pencil />
                {isAwaitingApproval ? 'Request changes' : 'Edit'}
              </Button>
            ) : null}
            {onDiscardDraft ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDiscardDraft}
                disabled={isSending}
              >
                <Trash2 />
                Discard
              </Button>
            ) : null}
          </div>
        ) : !isDraft && (onReply || onReplyAll || onForward) ? (
          <div className="mt-3 flex gap-2 md:ml-[42px]">
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
          </div>
        ) : null}

        <MailAttachments
          attachments={message.attachments ?? []}
          onOpen={onOpenAttachment}
        />
      </div>
    </article>
  )
}
