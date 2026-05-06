'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowDown, MessageSquare, RotateCw } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { CommentInput } from './comment-input'
import { issueActiveRunOptions } from '@/lib/issues/queries'

type ComposerMode = 'answer' | 'note' | 'redirect'

function modeForRunStatus(status: string | null | undefined): ComposerMode {
  if (status === 'waiting_for_input') return 'answer'
  if (
    status === 'running' ||
    status === 'queued' ||
    status === 'waiting_for_approval'
  )
    return 'note'
  return 'redirect'
}

const MODE_COPY: Record<
  ComposerMode,
  {
    placeholder: string
    caption: string
    Icon: React.ComponentType<{ className?: string }>
  }
> = {
  answer: {
    placeholder: '',
    caption: 'Garden is waiting on you. Use the question card above.',
    Icon: ArrowDown,
  },
  note: {
    placeholder: 'Drop a note (won’t interrupt)',
    caption: 'The agent will see this on its next turn.',
    Icon: MessageSquare,
  },
  redirect: {
    placeholder: 'Redirect Garden — sending fires a new run',
    caption: 'Sending starts a fresh turn with this as the trigger.',
    Icon: RotateCw,
  },
}

export function ContextualComposer({
  issueId,
  onSubmit,
  onOpenChat,
  openChatPending = false,
}: {
  issueId: string
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>
  /** When provided, renders an inline "Open chat" CTA next to the composer. */
  onOpenChat?: () => void
  openChatPending?: boolean
}) {
  const { data } = useQuery(issueActiveRunOptions(issueId))
  const mode = modeForRunStatus(data?.run?.status ?? null)
  const { placeholder, caption, Icon } = MODE_COPY[mode]

  if (mode === 'answer') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{caption}</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <CommentInput
        key={mode}
        issueId={issueId}
        onSubmit={onSubmit}
        placeholder={placeholder}
        accent={mode === 'redirect' ? 'redirect' : 'default'}
      />
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{caption}</span>
        {onOpenChat ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={onOpenChat}
            disabled={openChatPending}
            className="ml-auto h-5 gap-1 px-1.5 text-[11px] text-info hover:bg-info/10 hover:text-info"
          >
            <MessageSquare className="h-3 w-3" />
            {openChatPending ? 'Opening…' : 'Open in chat'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
