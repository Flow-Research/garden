// Direct adaptation of Cloudflare Agentic Inbox's AgentSidebar and AgentPanel (Apache-2.0).
// Pinned source and notice: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { Markdown } from '@garden/ui/markdown'
import { cn } from '@garden/ui/lib/utils'
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
} from '@/components/ai-elements/confirmation'
import {
  Archive,
  ArrowUp,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleSlash2,
  Mail,
  MailOpen,
  Paperclip,
  PenLine,
  Reply,
  Search,
  Star,
  Square,
  Tag,
  Trash2,
  Undo2,
  User,
  Wrench,
  X,
} from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'

export type MailAgentToolState =
  | 'input-streaming'
  | 'input-available'
  | 'running'
  | 'waiting-approval'
  | 'output-available'
  | 'output-error'
  | 'denied'
  | 'result'

export type MailAgentTextPart = {
  type: 'text'
  text: string
}

export type MailAgentToolPart = {
  type: 'tool'
  toolName: string
  state: MailAgentToolState
  input?: unknown
  output?: unknown
}

export type MailAgentMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: ReadonlyArray<MailAgentTextPart | MailAgentToolPart>
}

export type MailAgentStatus = 'idle' | 'submitted' | 'streaming' | 'error'

export type MailAgentSidebarProps = {
  messages: ReadonlyArray<MailAgentMessage>
  status: MailAgentStatus
  errorMessage?: string
  input: string
  onInputChange: (value: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onClear?: () => void
  onClose?: () => void
  onResolveApproval?: (
    executionId: string,
    approved: boolean,
  ) => Promise<'approved' | 'declined' | 'expired'>
}

type ToolPresentation = {
  activeLabel: string
  completeLabel: string
  errorLabel: string
  icon: ReactNode
}

const toolPresentations: Readonly<Record<string, ToolPresentation>> = {
  tool_executor_skills: {
    activeLabel: 'Checking email tools',
    completeLabel: 'Email tools ready',
    errorLabel: 'Email tools unavailable',
    icon: <Search />,
  },
  tool_executor_resume: {
    activeLabel: 'Waiting for approval',
    completeLabel: 'Approval resolved',
    errorLabel: 'Approval expired',
    icon: <Reply />,
  },
  compose_mail: {
    activeLabel: 'Saving draft',
    completeLabel: 'Draft saved and opened',
    errorLabel: 'Draft could not be saved',
    icon: <PenLine />,
  },
}

const executorOperations: ReadonlyArray<{
  matches: (code: string) => boolean
  presentation: ToolPresentation
}> = [
  {
    matches: (code) =>
      /\.threads\.modify|\.messages\.modify/.test(code) &&
      /removeLabelIds\s*:\s*\[[^\]]*["']INBOX["']/.test(code),
    presentation: {
      activeLabel: 'Archiving email',
      completeLabel: 'Email archived',
      errorLabel: 'Email could not be archived',
      icon: <Archive />,
    },
  },
  {
    matches: (code) =>
      /\.threads\.modify|\.messages\.modify/.test(code) &&
      /addLabelIds\s*:\s*\[[^\]]*["']INBOX["']/.test(code),
    presentation: {
      activeLabel: 'Moving to inbox',
      completeLabel: 'Moved to inbox',
      errorLabel: 'Email could not be moved',
      icon: <Undo2 />,
    },
  },
  {
    matches: (code) =>
      /\.threads\.modify|\.messages\.modify/.test(code) &&
      /removeLabelIds\s*:\s*\[[^\]]*["']UNREAD["']/.test(code),
    presentation: {
      activeLabel: 'Marking as read',
      completeLabel: 'Marked as read',
      errorLabel: 'Read status could not be changed',
      icon: <MailOpen />,
    },
  },
  {
    matches: (code) =>
      /\.threads\.modify|\.messages\.modify/.test(code) &&
      /addLabelIds\s*:\s*\[[^\]]*["']UNREAD["']/.test(code),
    presentation: {
      activeLabel: 'Marking as unread',
      completeLabel: 'Marked as unread',
      errorLabel: 'Read status could not be changed',
      icon: <Mail />,
    },
  },
  {
    matches: (code) =>
      /\.threads\.modify|\.messages\.modify/.test(code) &&
      /(?:add|remove)LabelIds\s*:\s*\[[^\]]*["']STARRED["']/.test(code),
    presentation: {
      activeLabel: 'Updating star',
      completeLabel: 'Star updated',
      errorLabel: 'Star could not be changed',
      icon: <Star />,
    },
  },
  {
    matches: (code) => /\.threads\.trash|\.messages\.trash/.test(code),
    presentation: {
      activeLabel: 'Moving to trash',
      completeLabel: 'Moved to trash',
      errorLabel: 'Email could not be moved to trash',
      icon: <Trash2 />,
    },
  },
  {
    matches: (code) => /\.threads\.untrash|\.messages\.untrash/.test(code),
    presentation: {
      activeLabel: 'Restoring email',
      completeLabel: 'Email restored',
      errorLabel: 'Email could not be restored',
      icon: <Undo2 />,
    },
  },
  {
    matches: (code) => /\.messages\.attachments\.get/.test(code),
    presentation: {
      activeLabel: 'Loading attachment',
      completeLabel: 'Attachment loaded',
      errorLabel: 'Attachment could not be loaded',
      icon: <Paperclip />,
    },
  },
  {
    matches: (code) => /\.threads\.get/.test(code),
    presentation: {
      activeLabel: 'Reading conversation',
      completeLabel: 'Conversation read',
      errorLabel: 'Conversation could not be read',
      icon: <Reply />,
    },
  },
  {
    matches: (code) => /\.messages\.get/.test(code),
    presentation: {
      activeLabel: 'Reading email',
      completeLabel: 'Email read',
      errorLabel: 'Email could not be read',
      icon: <MailOpen />,
    },
  },
  {
    matches: (code) =>
      /\.threads\.list|\.messages\.list/.test(code) && /\bq\s*:/.test(code),
    presentation: {
      activeLabel: 'Searching emails',
      completeLabel: 'Emails found',
      errorLabel: 'Emails could not be searched',
      icon: <Search />,
    },
  },
  {
    matches: (code) => /\.threads\.list|\.messages\.list/.test(code),
    presentation: {
      activeLabel: 'Fetching emails',
      completeLabel: 'Emails loaded',
      errorLabel: 'Emails could not be loaded',
      icon: <Mail />,
    },
  },
  {
    matches: (code) => /\.threads\.modify|\.messages\.modify/.test(code),
    presentation: {
      activeLabel: 'Updating email',
      completeLabel: 'Email updated',
      errorLabel: 'Email could not be updated',
      icon: <Mail />,
    },
  },
  {
    matches: (code) => /\.labels\.(?:get|list)/.test(code),
    presentation: {
      activeLabel: 'Checking labels',
      completeLabel: 'Labels checked',
      errorLabel: 'Labels could not be checked',
      icon: <Tag />,
    },
  },
  {
    matches: (code) => /\.getProfile/.test(code),
    presentation: {
      activeLabel: 'Checking mailbox',
      completeLabel: 'Mailbox checked',
      errorLabel: 'Mailbox could not be checked',
      icon: <Mail />,
    },
  },
]

const genericExecutorPresentation: ToolPresentation = {
  activeLabel: 'Working with email',
  completeLabel: 'Email action complete',
  errorLabel: 'Email action failed',
  icon: <Mail />,
}

const genericToolPresentation: ToolPresentation = {
  activeLabel: 'Working',
  completeLabel: 'Done',
  errorLabel: 'Action failed',
  icon: <Wrench />,
}

/**
 * Converts Executor's single codemode surface into the same human activity
 * labels used by Cloudflare Agentic Inbox. Only the operation name is inferred;
 * code, provider identifiers, arguments, and outputs never enter the UI.
 */
export function mailAgentToolPresentation(
  part: MailAgentToolPart,
): ToolPresentation {
  if (part.toolName !== 'tool_executor_execute') {
    return toolPresentations[part.toolName] ?? genericToolPresentation
  }
  const code =
    part.input && typeof part.input === 'object' && 'code' in part.input
      ? (part.input as { code?: unknown }).code
      : null
  if (typeof code !== 'string') return genericExecutorPresentation
  return (
    executorOperations.find((operation) => operation.matches(code))
      ?.presentation ?? genericExecutorPresentation
  )
}

/** Reads only Executor's public status discriminator, never result content. */
const outputStatus = (output: unknown): string | null => {
  if (!output || typeof output !== 'object') return null
  const record = output as Record<string, unknown>
  if (typeof record.status === 'string') return record.status
  const structured = record.structuredContent
  if (!structured || typeof structured !== 'object') return null
  const status = (structured as Record<string, unknown>).status
  return typeof status === 'string' ? status : null
}

/** Extracts only Executor's opaque execution handle from a paused result. */
export const mailAgentApprovalExecutionId = (
  output: unknown,
): string | null => {
  if (!output || typeof output !== 'object') return null
  const record = output as Record<string, unknown>
  const structured =
    record.structuredContent && typeof record.structuredContent === 'object'
      ? (record.structuredContent as Record<string, unknown>)
      : record
  const status = structured.status
  const executionId = structured.executionId
  return (status === 'waiting_for_interaction' ||
    status === 'user_approval_required') &&
    typeof executionId === 'string' &&
    /^exec_[0-9a-f-]{36}$/i.test(executionId)
    ? executionId
    : null
}

const suggestedPrompts = [
  'Summarize this email',
  'What needs action?',
  'Draft a reply',
] as const

/** Mirrors Cloudflare's tool activity row while keeping tool state external. */
function ToolCallBadge({
  part,
  approvalState,
  onResolveApproval,
}: {
  part: MailAgentToolPart
  approvalState?: 'resolving' | 'approved' | 'declined' | 'expired'
  onResolveApproval?: (executionId: string, approved: boolean) => void
}) {
  const presentation = mailAgentToolPresentation(part)
  const status = outputStatus(part.output)
  const needsApproval =
    part.state === 'waiting-approval' ||
    status === 'paused' ||
    status === 'waiting_for_interaction' ||
    status === 'user_approval_required'
  const denied =
    part.state === 'denied' ||
    Boolean(status && /declin|denied|cancel/.test(status))
  const failed =
    part.state === 'output-error' ||
    Boolean(
      status &&
      (/error|fail|expired|forbidden|not_found|unavailable/.test(status) ||
        status === 'needs_open_email' ||
        status === 'sender_unavailable'),
    )
  const done =
    !needsApproval &&
    !denied &&
    !failed &&
    (part.state === 'output-available' || part.state === 'result')
  const label = needsApproval
    ? 'Approval needed'
    : denied
      ? 'Action declined'
      : failed
        ? presentation.errorLabel
        : done
          ? presentation.completeLabel
          : presentation.activeLabel
  const executionId = mailAgentApprovalExecutionId(part.output)

  if (needsApproval && executionId && onResolveApproval) {
    if (approvalState && approvalState !== 'resolving') {
      const resolvedLabel =
        approvalState === 'approved'
          ? 'Action approved'
          : approvalState === 'declined'
            ? 'Action declined'
            : 'Approval expired'
      return (
        <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs">
          {approvalState === 'approved' ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <CircleSlash2 className="size-3.5 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">{resolvedLabel}</span>
        </div>
      )
    }
    return (
      <Confirmation
        approval={{ id: executionId }}
        state="approval-requested"
        className="gap-2 p-2"
      >
        <ConfirmationRequest>
          <p className="text-xs font-medium text-foreground">
            Allow {presentation.activeLabel.toLowerCase()}?
          </p>
        </ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction
            variant="outline"
            disabled={approvalState === 'resolving'}
            onClick={() => onResolveApproval(executionId, false)}
          >
            Deny
          </ConfirmationAction>
          <ConfirmationAction
            disabled={approvalState === 'resolving'}
            onClick={() => onResolveApproval(executionId, true)}
          >
            {approvalState === 'resolving' ? <Spinner /> : null}
            Approve
          </ConfirmationAction>
        </ConfirmationActions>
      </Confirmation>
    )
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs"
      role="status"
      aria-label={label}
    >
      <span
        className={cn(
          '[&_svg]:size-3.5',
          failed
            ? 'text-destructive'
            : needsApproval
              ? 'text-warning'
              : denied
                ? 'text-muted-foreground'
                : 'text-brand',
        )}
      >
        {needsApproval ? (
          <CircleAlert />
        ) : failed ? (
          <CircleAlert />
        ) : denied ? (
          <CircleSlash2 />
        ) : (
          presentation.icon
        )}
      </span>
      <span className="font-medium text-foreground">{label}</span>
      {done ? (
        <CheckCircle2 className="ml-auto size-3 text-success" />
      ) : failed || denied || needsApproval ? null : (
        <Spinner className="ml-auto size-3" />
      )}
    </div>
  )
}

/**
 * Ports Cloudflare's user/agent message row. Tool activity is rendered from
 * the live AI SDK message parts rather than fixture-only cards.
 */
function MessageBubble({
  message,
  approvalStates,
  onResolveApproval,
}: {
  message: MailAgentMessage
  approvalStates: Readonly<
    Record<string, 'resolving' | 'approved' | 'declined' | 'expired'>
  >
  onResolveApproval?: (executionId: string, approved: boolean) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-brand text-brand-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {isUser ? <User className="size-3" /> : <Bot className="size-3" />}
      </div>
      <div
        className={cn(
          'flex min-w-0 max-w-[85%] flex-col gap-1',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {message.parts.map((part, index) =>
          part.type === 'text' && part.text.trim() ? (
            <div
              key={`${message.id}-part-${index}`}
              className={cn(
                'max-w-full break-words rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                isUser
                  ? 'rounded-br-sm bg-brand text-brand-foreground'
                  : 'overflow-hidden rounded-bl-sm border bg-card text-card-foreground',
              )}
            >
              {isUser ? (
                part.text
              ) : (
                <Markdown mode="minimal">{part.text}</Markdown>
              )}
            </div>
          ) : part.type === 'tool' ? (
            <ToolCallBadge
              key={`${message.id}-part-${index}`}
              part={part}
              approvalState={
                mailAgentApprovalExecutionId(part.output)
                  ? approvalStates[
                      mailAgentApprovalExecutionId(part.output) ?? ''
                    ]
                  : undefined
              }
              onResolveApproval={onResolveApproval}
            />
          ) : null,
        )}
      </div>
    </div>
  )
}

/**
 * Controlled Cloudflare AgentPanel port. The owning controller supplies chat,
 * input, streaming and tool state, so the view needs no effect-driven syncing.
 */
function MailAgentPanel({
  messages,
  status,
  errorMessage,
  input,
  onInputChange,
  onSend,
  onStop,
  onClear,
  onClose,
  onResolveApproval,
}: MailAgentSidebarProps) {
  const streaming = status === 'streaming' || status === 'submitted'
  const [approvalStates, setApprovalStates] = useState<
    Record<string, 'resolving' | 'approved' | 'declined' | 'expired'>
  >({})
  const resolveApproval = onResolveApproval
    ? (executionId: string, approved: boolean) => {
        setApprovalStates((current) => ({
          ...current,
          [executionId]: 'resolving',
        }))
        void onResolveApproval(executionId, approved).then(
          (next) =>
            setApprovalStates((current) => ({
              ...current,
              [executionId]: next,
            })),
          () =>
            setApprovalStates((current) => ({
              ...current,
              [executionId]: 'expired',
            })),
        )
      }
    : undefined

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    onSend(trimmed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    send(input)
  }

  return (
    <div className="relative flex h-full flex-col">
      {onClose ? (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close agent"
          className="absolute right-2 top-2 z-10"
        >
          <X />
        </Button>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length > 0 && onClear ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClear}
            aria-label="Clear chat"
            className="float-right"
          >
            <Trash2 />
          </Button>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-brand/10">
              <Bot className="size-6 text-brand" />
            </div>
            <p className="px-4 text-center text-xs leading-relaxed text-muted-foreground">
              I can read emails, search conversations, and draft replies.
            </p>
            <div className="flex w-full flex-col gap-1.5">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="cursor-pointer rounded-lg border bg-transparent px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                approvalStates={approvalStates}
                onResolveApproval={resolveApproval}
              />
            ))}
            {streaming ? (
              <div className="flex gap-2">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Bot className="size-3" />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg rounded-bl-sm border bg-card px-3 py-2">
                  <Spinner className="size-3" />
                  <span className="text-xs text-muted-foreground">
                    Thinking...
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {status === 'error' && errorMessage ? (
          <div
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
          >
            <CircleAlert className="size-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t px-3 py-2">
        {streaming ? (
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" onClick={onStop}>
              <Square className="fill-current" />
              Stop generating
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <textarea
              id="mail-agent-chat-input"
              name="mail-agent-chat-input"
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onInput={(event) => {
                const target = event.currentTarget
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 100)}px`
                target.style.overflow =
                  target.scrollHeight > 100 ? 'auto' : 'hidden'
              }}
              placeholder="Ask your email agent..."
              autoFocus
              rows={1}
              aria-label="Chat message input"
              className="min-h-9 max-h-[100px] flex-1 resize-none overflow-hidden rounded-lg border bg-card px-3 py-2 text-xs text-card-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
            <Button
              size="icon-sm"
              disabled={!input.trim()}
              onClick={() => send(input)}
              aria-label="Send message"
            >
              <ArrowUp />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Controlled port of Cloudflare's mailbox agent panel. Garden intentionally
 * omits Cloudflare's MCP tab: connector administration is a separate product
 * surface, while this panel exists only for collaborating on selected mail.
 */
export function MailAgentSidebar(props: MailAgentSidebarProps) {
  return (
    <aside
      aria-label="Mailbox agent"
      className="flex h-full flex-col bg-background"
    >
      <MailAgentPanel {...props} />
    </aside>
  )
}
