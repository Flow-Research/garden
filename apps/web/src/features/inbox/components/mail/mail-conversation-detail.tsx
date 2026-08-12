// Adapted from Zero's ThreadDisplay (MIT) and Cloudflare Agentic Inbox's EmailPanel (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import type { ReactNode } from 'react'
import { MailMessage, type MailMessageProps } from './mail-message'
import type { MailConversationView, MailMessageView } from './types'

export type MailConversationDetailProps = {
  conversation: MailConversationView
  toolbar: ReactNode
  expandedMessageIds: ReadonlySet<string>
  replyingToMessageId?: string
  inlineComposer?: ReactNode
  onToggleMessage: (messageId: string) => void
  messageActions?: (
    message: MailMessageView,
  ) => Omit<MailMessageProps, 'message' | 'expanded' | 'onToggleExpanded'>
}

/** Zero thread structure with a controlled inline composer after its target. */
export function MailConversationDetail({
  conversation,
  toolbar,
  expandedMessageIds,
  replyingToMessageId,
  inlineComposer,
  onToggleMessage,
  messageActions,
}: MailConversationDetailProps) {
  const latestMessageId = conversation.messages.at(-1)?.id
  const latestReplyComposer =
    replyingToMessageId === latestMessageId ? inlineComposer : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="border-b bg-background px-5 py-4">
          <div className="flex items-baseline gap-2">
            <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
              {conversation.subject || '(no subject)'}
            </h1>
            {conversation.messageCount > 1 ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {conversation.messageCount} messages
              </span>
            ) : null}
          </div>
          {conversation.labels && conversation.labels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {conversation.labels.map((label) => (
                <span
                  key={label.id}
                  className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div>
          {conversation.messages.map((message, index) => (
            <div key={message.id}>
              <MailMessage
                message={message}
                expanded={expandedMessageIds.has(message.id)}
                isLast={index === conversation.messages.length - 1}
                onToggleExpanded={() => onToggleMessage(message.id)}
                {...messageActions?.(message)}
              />
              {replyingToMessageId === message.id &&
              message.id !== latestMessageId
                ? inlineComposer
                : null}
            </div>
          ))}
        </div>
      </div>
      {latestReplyComposer ? (
        <div
          data-mail-reply-surface="sticky"
          className="z-10 shrink-0 border-t bg-background px-4 py-2"
        >
          {latestReplyComposer}
        </div>
      ) : null}
    </div>
  )
}
