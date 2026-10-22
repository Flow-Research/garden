/**
 * Chat timeline rendering.
 *
 * Extracted from `agent-interaction-screen.tsx`. Owns:
 *   - `MessageActionButton` / `CopyButton` / `MessageFeedback` — the icon row
 *     under an assistant reply (copy, thumbs up, thumbs down).
 *   - `ChatError` — recoverable-error surface with retry / copy.
 *   - `ChatTimeline` — the master loop that renders messages, attachments,
 *     tool activity, citations, and approvals into the conversation feed.
 *   - `getChatTimelineRowKey` — stable key fn used by the conversation
 *     virtualizer.
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { cn } from '@garden/ui/lib/utils'
import {
  Message,
  MessageContent,
  MessageFooter,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import type { ChatUiMessage } from '../chat-runtime-provider'
import type { GardenArtifactData } from '@/features/artifacts/artifact-renderer'
import type { DocumentCitationAnnotation } from './chat-document-panel'
import {
  MessageCitations,
  MessageOrderedParts,
  MessageSources,
  type ApprovalGroup,
} from './chat-message-parts'
import {
  MessageToolApprovals,
  PendingAssistantActivity,
} from './chat-tool-activity'
import { MessageFiles } from './chat-message-files'
import { isToolUIPart } from 'ai'
import { isToolPartActive } from './chat-tool-state'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import type { RealtimeStatus } from '../chat-runtime-provider'
import { stripGardenInternalDocumentContext } from './chat-message-parts'
import { normalizeStatus } from './composer'

// Local helpers (formerly in agent-interaction-screen.tsx)
function getText(parts: ChatUiMessage['parts']) {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim()
}

function getDisplayText(message: ChatUiMessage) {
  const text = getText(message.parts)
  return message.role === 'user'
    ? stripGardenInternalDocumentContext(text)
    : text
}

/**
 * Shared shell for the message footer icons.
 *
 * Before: the copy action was a lone 12px glyph in a tight 6px pad, so it read
 * as a stray mark rather than a control. The design specifies a 32px hit area
 * around a 16px icon with a 4px radius and no surface until hover, which is
 * also what makes the three actions sit on an even 32px rhythm.
 */
function MessageActionButton({
  children,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded',
        'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        pressed && 'text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <MessageActionButton
      label={copied ? 'Copied' : 'Copy'}
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="size-4 text-success" />
      ) : (
        <Copy className="size-4" />
      )}
    </MessageActionButton>
  )
}

/**
 * Thumbs up / down on an assistant reply.
 *
 * The design pairs a rating with the copy action in the footer. There is no
 * feedback endpoint or table behind it yet, so the choice is held in component
 * state: the control shows what the reader picked and lets them take it back,
 * and it deliberately claims nothing more than that. When a feedback mutation
 * lands, replace the `setRating` calls with it — the markup does not change.
 */
function MessageFeedback() {
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const toggle = (next: 'up' | 'down') =>
    setRating((current) => (current === next ? null : next))

  return (
    <>
      <MessageActionButton
        label="Good response"
        onClick={() => toggle('up')}
        pressed={rating === 'up'}
      >
        <ThumbsUp className="size-4" />
      </MessageActionButton>
      <MessageActionButton
        label="Bad response"
        onClick={() => toggle('down')}
        pressed={rating === 'down'}
      >
        <ThumbsDown className="size-4" />
      </MessageActionButton>
    </>
  )
}

export function ChatError({
  error,
  onRetry,
  isRetrying,
}: {
  error: Error | null
  onRetry?: () => void
  isRetrying?: boolean
}) {
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const [showDetails, setShowDetails] = useState(false)

  if (!error) return null

  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
        <div className="mt-0.5 shrink-0 text-destructive">
          <X className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm font-medium text-destructive">
            Something went wrong
          </p>
          <p className="text-sm text-muted-foreground">
            The agent encountered an error. You can try sending your message
            again.
          </p>
          {debugMode ? (
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="self-start text-xs text-muted-foreground underline hover:text-foreground"
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          ) : null}
          {debugMode && showDetails ? (
            <pre className="mt-1 max-h-48 overflow-auto rounded border bg-background p-2 text-xs text-foreground">
              <code>{error.message}</code>
              {error.stack ? (
                <code className="mt-1 block text-muted-foreground">
                  {error.stack}
                </code>
              ) : null}
            </pre>
          ) : null}
          {onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={isRetrying}
              className="mt-1 self-start"
            >
              {isRetrying ? (
                <Spinner className="mr-2" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Memoized because the controller above it re-renders on every keystroke: the
 * composer's draft lives in the chat store and the controller subscribes to it
 * to drive the (controlled) input field. Without this the whole LegendList
 * tree re-rendered per character even though nothing it renders had changed.
 *
 * That only pays off while every prop keeps its identity between those
 * renders, which is why the controller routes `onRetry` through a ref and
 * hands over a shared empty-message constant.
 */
const ChatTimelineComponent = ({
  debugMode,
  sessionId,
  messages,
  error,
  status,
  isRecovering,
  isStreaming,
  onOpenDocument,
  onOpenCitation,
  onResolveToolApproval,
  resolvedApprovalIds,
  resolvedPermissionRequestIds,
  resolvingToolCallIds,
  onRetry,
  isRetrying,
  forcePendingActivity,
}: {
  debugMode: boolean
  sessionId: string
  messages: ChatUiMessage[]
  error: Error | null
  status: RealtimeStatus
  isRecovering: boolean
  /**
   * Universal streaming flag from `useAgentChat` (`status === 'streaming'` OR a
   * server-initiated stream). The AI SDK `status` only tracks client-initiated
   * request/response cycles, so with `messageConcurrency='merge'` a
   * server-pushed continuation (auto-continue after `addToolOutput` /
   * `addToolApprovalResponse`, or durable recovery) never moves `status` and the
   * timeline looked idle mid-turn. Drive the pending row + per-message streaming
   * state from this so merged/server turns render as active.
   */
  isStreaming: boolean
  onOpenDocument?: (artifact: GardenArtifactData) => void
  onOpenCitation?: (citation: DocumentCitationAnnotation) => void
  onResolveToolApproval: (
    group: ApprovalGroup,
    approved: boolean,
  ) => Promise<void>
  resolvedApprovalIds: string[]
  /**
   * Permission-request ids the server reports as no longer pending (B2). A
   * propose_agent approval whose request is in this set is hidden regardless of
   * local optimistic state, so a reconnected card reconciles to durable status.
   */
  resolvedPermissionRequestIds: ReadonlySet<string>
  resolvingToolCallIds: string[]
  onRetry?: () => void
  isRetrying?: boolean
  forcePendingActivity?: boolean
}) => {
  const normalizedStatus = normalizeStatus(status)
  const latestMessage = messages[messages.length - 1]
  const latestParts = latestMessage?.parts ?? []
  const latestIsAssistant = latestMessage?.role === 'assistant'
  // "Moving" = a part that is still receiving updates: a streaming tool call,
  // a tool waiting for approval, or in-progress text. The pending placeholder
  // hides while any moving activity is on-screen.
  const latestHasMovingActivity =
    latestIsAssistant && latestParts.some(isToolPartActive)
  // "Visible activity" = any text or tool that has rendered. This decides
  // whether we use the placeholder *before* the first chunk lands.
  const latestHasVisibleActivity =
    latestIsAssistant &&
    (getText(latestParts).length > 0 ||
      latestParts.some((part) => isToolUIPart(part)))
  // Show the placeholder during latency gaps too — when the SDK is still
  // streaming but every part on screen has settled and no new chunk has
  // arrived, keeping feedback visible between tool boundaries.
  const showPendingActivity =
    forcePendingActivity ||
    isRecovering ||
    normalizedStatus === 'submitted' ||
    (isStreaming && (!latestHasVisibleActivity || !latestHasMovingActivity))
  const rows = useMemo<ChatTimelineRow[]>(() => {
    const nextRows: ChatTimelineRow[] = messages.map((message) => ({
      id: `message:${message.id}`,
      kind: 'message',
      message,
    }))

    if (showPendingActivity) {
      // During gaps where the model has emitted a tool result and is now
      // composing the next step, prefer "Thinking…" — it matches what the
      // user perceives. During the first wait of a turn, also "Thinking…".
      // We never reach this branch while a tool is actively running, so the
      // historical "Working…" copy was almost always wrong.
      nextRows.push({
        id: `pending:${isRecovering ? 'recovering' : normalizedStatus}`,
        kind: 'pending',
        label: isRecovering ? 'Recovering...' : 'Thinking...',
      })
    }

    if (error) {
      nextRows.push({
        error,
        id: 'chat-error',
        kind: 'error',
      })
    }

    return nextRows
  }, [error, isRecovering, messages, normalizedStatus, showPendingActivity])

  const renderTimelineRow = useCallback(
    ({ item }: { item: ChatTimelineRow }) => {
      if (item.kind === 'pending') {
        return (
          <Message from="assistant">
            <MessageContent>
              <PendingAssistantActivity label={item.label} />
            </MessageContent>
          </Message>
        )
      }

      if (item.kind === 'error') {
        return (
          <ChatError
            error={item.error}
            onRetry={onRetry}
            isRetrying={isRetrying}
          />
        )
      }

      const text = getDisplayText(item.message)
      const isLatestStreaming =
        isStreaming && item.message.id === latestMessage?.id
      // `MessageContent` is now the user bubble itself, so attachments have to
      // sit outside it — the design shows the file card above the bubble, and
      // leaving it inside painted the card on brand green. It becomes a direct
      // child of `Message`, which already right-aligns user rows.
      //
      // That also means an attachment-only user message (a file dropped with no
      // prompt) must skip the bubble entirely, otherwise it renders as an empty
      // green sliver. Assistant rows always keep the wrapper: it is transparent
      // and carries the tool/citation/approval column.
      const hasBubble = item.message.role !== 'user' || text.length > 0
      return (
        <Message from={item.message.role}>
          <MessageFiles message={item.message} />
          {hasBubble ? (
            <MessageContent>
              <MessageOrderedParts
                debugMode={debugMode}
                isLatestStreaming={isLatestStreaming}
                message={item.message}
                onOpenDocument={onOpenDocument}
              />
              <MessageSources message={item.message} />
              <MessageCitations
                message={item.message}
                onOpenCitation={onOpenCitation}
              />
              <MessageToolApprovals
                debugMode={debugMode}
                message={item.message}
                onResolve={onResolveToolApproval}
                resolvedApprovalIds={resolvedApprovalIds}
                resolvedPermissionRequestIds={resolvedPermissionRequestIds}
                resolvingToolCallIds={resolvingToolCallIds}
              />
            </MessageContent>
          ) : null}
          {text ? (
            <MessageFooter>
              <CopyButton text={text} />
              {item.message.role === 'assistant' ? <MessageFeedback /> : null}
            </MessageFooter>
          ) : null}
        </Message>
      )
    },
    [
      debugMode,
      isRetrying,
      isStreaming,
      latestMessage?.id,
      normalizedStatus,
      onOpenCitation,
      onOpenDocument,
      onResolveToolApproval,
      onRetry,
      resolvedApprovalIds,
      resolvedPermissionRequestIds,
      resolvingToolCallIds,
    ],
  )

  return (
    <Conversation
      key={sessionId}
      className="min-h-0 flex-1"
      data={rows}
      drawDistance={600}
      estimateItemSize={90}
      getItemKey={getChatTimelineRowKey}
      initialContainerPoolRatio={3}
      renderItem={renderTimelineRow}
    >
      <ConversationScrollButton className="rounded-full text-xs" />
    </Conversation>
  )
}

export const ChatTimeline = memo(ChatTimelineComponent)
ChatTimeline.displayName = 'ChatTimeline'

export function getChatTimelineRowKey(row: ChatTimelineRow) {
  return row.id
}

type ChatTimelineRow =
  | {
      id: string
      kind: 'message'
      message: ChatUiMessage
    }
  | {
      id: string
      kind: 'pending'
      label: string
    }
  | {
      error: Error
      id: string
      kind: 'error'
    }
