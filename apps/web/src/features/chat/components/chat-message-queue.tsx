/**
 * `ChatMessageQueue` — the stack of messages the person wrote while the agent
 * was still answering, parked directly above the composer.
 *
 * Why this exists: until now the composer swapped its send button for a stop
 * button the moment a turn started, so anything typed mid-reply had nowhere to
 * go — the person either interrupted the agent or waited. The 2026-09-16 queue
 * design keeps those messages visible as rows that the controller drains in
 * order once the current turn finishes.
 *
 * Behaviour before the 2026-09-17 review: every row was two lines tall (a
 * "Queue 1 · Reply after current reply" label above the text), painted its own
 * always-on tertiary fill, and carried three permanently visible actions
 * including a copy button. Four queued messages pushed the composer most of the
 * way up the panel.
 *
 * After: the position and the "sends after this reply" explanation are said
 * once, in a header line over the whole stack, and each message is a single
 * quiet row. Rows take a fill only under the pointer or keyboard focus, and
 * their actions — edit, send next, remove — appear with it. Copy is gone: the
 * text is right there, and for a message that is about to be sent anyway it was
 * the least likely of the four to be wanted.
 *
 * Presentation only. The queue itself lives in `chat-panel-controller.tsx`,
 * which owns enqueue/drain ordering; this file just renders what it is given.
 * It mounts through `Composer`'s `queue` slot so it sits inside the pill's own
 * width wrapper — the slab below reads as the composer growing upward, and
 * that only works as a sibling of the pill.
 */

import { ArrowUp, PencilLine, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@garden/ui/lib/utils'
import type { SelectedThreadDocument } from './document-selection'

/** One parked send, holding the exact payload `handleSend` would have run. */
export interface QueuedChatMessage {
  id: string
  text: string
  files: File[]
  selectedDocuments: SelectedThreadDocument[]
}

/**
 * Icon action inside a queue row. 24px box with a 16px glyph, so a row of them
 * lands on a 24px pitch with no gap between the buttons — the hover surfaces
 * stay adjacent instead of leaving dead slivers between hit targets.
 *
 * Hidden until its row is hovered or something inside it takes focus. It stays
 * in the layout rather than unmounting (`opacity`, not `hidden`) so the row's
 * width never shifts under the pointer, and `focus-visible:opacity-100` keeps
 * it reachable by keyboard, where there is no hover to reveal it.
 */
function QueueRowAction({
  children,
  label,
  onClick,
}: {
  children: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded',
        'text-icon-secondary transition-[color,opacity] hover:text-icon-default',
        'opacity-0 group-hover/queue-row:opacity-100 group-focus-within/queue-row:opacity-100 focus-visible:opacity-100',
      )}
    >
      {children}
    </button>
  )
}

export function ChatMessageQueue({
  className,
  messages,
  onEdit,
  onSendNext,
  onRemove,
}: {
  className?: string
  messages: QueuedChatMessage[]
  /** Pulls the message out of the queue and back into the composer draft. */
  onEdit: (message: QueuedChatMessage) => void
  /** Moves the message to the front of the queue. */
  onSendNext: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (messages.length === 0) return null

  /*
    The slab is the composer's pill extended upward, mirroring the queue's
    position above it: `-mb-8` slides it down behind the pill far enough that
    its square bottom corners never show, and `pb-10` pushes the rows back
    above the pill's edge, leaving 8px of breathing room. The two are coupled —
    shrinking the negative margin without shrinking the padding drops the rows
    down under the pill.

    This depends on the pill painting above it, which is what `composer.tsx`'s
    `z-10` on the pill is for.
  */
  return (
    <div
      className={cn(
        '-mb-8 rounded-t-2xl bg-background-main-secondary px-3 pt-2.5 pb-10',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2 pb-1 text-xs">
        <span className="text-text-brand-secondary">
          {messages.length} queued
        </span>
        <span className="text-text-secondary">
          {messages.length === 1 ? 'Sends' : 'Send in order'} after this reply
        </span>
      </div>
      <ul aria-label="Queued messages" className="flex flex-col">
        {messages.map((message, index) => (
          <li
            key={message.id}
            className="group/queue-row flex items-center justify-between gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-background-main-tertiary focus-within:bg-background-main-tertiary"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-text-default">
              {message.text || describeAttachmentsOnly(message)}
            </p>
            {/*
              `-mr-1` pulls the 24px buttons back by the 4px each one pads
              around its 16px glyph, so the last icon sits on the row's padding
              edge rather than 4px inside it.
            */}
            <div className="-mr-1 flex shrink-0 items-center">
              <QueueRowAction
                label="Edit queued message"
                onClick={() => onEdit(message)}
              >
                <PencilLine className="size-4" />
              </QueueRowAction>
              {/*
                The first row is already next, so it gets no promote control —
                a button that provably does nothing is worse than its absence.
              */}
              {index > 0 ? (
                <QueueRowAction
                  label="Send this one next"
                  onClick={() => onSendNext(message.id)}
                >
                  <ArrowUp className="size-4" />
                </QueueRowAction>
              ) : null}
              <QueueRowAction
                label="Remove queued message"
                onClick={() => onRemove(message.id)}
              >
                <X className="size-4" />
              </QueueRowAction>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A queued send can be attachments with no prose. The row still needs a line of
 * body text, so name what is waiting rather than rendering an empty paragraph.
 */
function describeAttachmentsOnly(message: QueuedChatMessage) {
  const count = message.files.length + message.selectedDocuments.length
  if (count === 0) return 'Empty message'
  return `${count} attachment${count === 1 ? '' : 's'}`
}
