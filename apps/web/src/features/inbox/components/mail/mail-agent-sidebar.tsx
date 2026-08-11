// Direct adaptation of Cloudflare Agentic Inbox's AgentSidebar and AgentPanel (Apache-2.0).
// Pinned source and notice: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { Markdown } from '@garden/ui/markdown'
import { cn } from '@garden/ui/lib/utils'
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  Eye,
  Mail,
  Pencil,
  Plug,
  Reply,
  Search,
  Square,
  Trash2,
  User,
  Wrench,
} from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'

export type MailAgentToolState =
  | 'input-streaming'
  | 'input-available'
  | 'running'
  | 'output-available'
  | 'output-error'
  | 'result'

export type MailAgentTextPart = {
  type: 'text'
  text: string
}

export type MailAgentToolPart = {
  type: 'tool'
  toolName: string
  state: MailAgentToolState
}

export type MailAgentMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: ReadonlyArray<MailAgentTextPart | MailAgentToolPart>
}

export type MailAgentStatus = 'idle' | 'submitted' | 'streaming' | 'error'

export type MailAgentSidebarProps = {
  activeTab: 'agent' | 'integrations'
  onTabChange: (tab: 'agent' | 'integrations') => void
  integrationsPanel?: ReactNode
  messages: ReadonlyArray<MailAgentMessage>
  status: MailAgentStatus
  input: string
  onInputChange: (value: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onClear?: () => void
  onEditDraft?: (messageId: string) => void
  title?: string
}

const toolLabels: Readonly<Record<string, { label: string; icon: ReactNode }>> =
  {
    list_emails: { label: 'Fetching emails', icon: <Mail /> },
    mail_list_mailboxes: { label: 'Loading mailboxes', icon: <Mail /> },
    mail_list_conversations: { label: 'Fetching emails', icon: <Mail /> },
    mail_read_conversation: { label: 'Reading email', icon: <Eye /> },
    mail_create_draft: { label: 'Drafting email', icon: <Mail /> },
    mail_save_draft: { label: 'Saving draft', icon: <Mail /> },
    mail_request_draft_delivery: {
      label: 'Requesting approval',
      icon: <CheckCircle2 />,
    },
    get_email: { label: 'Reading email', icon: <Eye /> },
    get_thread: { label: 'Loading thread', icon: <Reply /> },
    search_emails: { label: 'Searching', icon: <Search /> },
    draft_email: { label: 'Drafting email', icon: <Mail /> },
    draft_reply: { label: 'Drafting reply', icon: <Mail /> },
    discard_draft: { label: 'Discarding draft', icon: <Trash2 /> },
    mark_email_read: { label: 'Updating status', icon: <CheckCircle2 /> },
    move_email: { label: 'Moving email', icon: <Mail /> },
  }

const suggestedPrompts = [
  'Show me the latest inbox emails',
  'Any unread emails?',
  'Draft a response to the latest email',
] as const

/** Mirrors Cloudflare's tool activity row while keeping tool state external. */
function ToolCallBadge({ part }: { part: MailAgentToolPart }) {
  const info = toolLabels[part.toolName] ?? {
    label: part.toolName,
    icon: <Wrench />,
  }
  const done =
    part.state === 'output-available' ||
    part.state === 'output-error' ||
    part.state === 'result'

  return (
    <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs">
      <span className="text-primary [&_svg]:size-3.5">{info.icon}</span>
      <span className="font-medium text-foreground">{info.label}</span>
      {done ? (
        <CheckCircle2 className="ml-auto size-3 text-success" />
      ) : (
        <Spinner className="ml-auto size-3" />
      )}
    </div>
  )
}

/**
 * Ports Cloudflare's user/agent message row. Tool activity and draft handoff
 * are rendered from canonical controller data rather than fixture-only cards.
 */
function MessageBubble({
  message,
  streaming,
  onEditDraft,
}: {
  message: MailAgentMessage
  streaming: boolean
  onEditDraft?: (messageId: string) => void
}) {
  const isUser = message.role === 'user'
  const hasDraftReply = message.parts.some(
    (part) => part.type === 'tool' && part.toolName === 'draft_reply',
  )

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-primary text-primary-foreground'
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
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'overflow-hidden rounded-bl-sm border bg-background text-foreground',
              )}
            >
              {isUser ? (
                part.text
              ) : (
                <Markdown mode="minimal">{part.text}</Markdown>
              )}
            </div>
          ) : part.type === 'tool' ? (
            <ToolCallBadge key={`${message.id}-part-${index}`} part={part} />
          ) : null,
        )}
        {!isUser && hasDraftReply && onEditDraft ? (
          <Button
            size="sm"
            className="mt-1"
            onClick={() => onEditDraft(message.id)}
            disabled={streaming}
          >
            <Pencil />
            Edit &amp; send in composer
          </Button>
        ) : null}
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
  input,
  onInputChange,
  onSend,
  onStop,
  onClear,
  onEditDraft,
  title = 'Email Agent',
}: Omit<
  MailAgentSidebarProps,
  'activeTab' | 'onTabChange' | 'integrationsPanel'
>) {
  const streaming = status === 'streaming' || status === 'submitted'

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
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Badge>AI</Badge>
          <span className="text-xs text-muted-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {streaming ? <Spinner className="size-3.5" /> : null}
          {messages.length > 0 && onClear ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClear}
              aria-label="Clear chat"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
              <Bot className="size-6 text-primary" />
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
                streaming={streaming}
                onEditDraft={onEditDraft}
              />
            ))}
            {streaming ? (
              <div className="flex gap-2">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Bot className="size-3" />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg rounded-bl-sm border bg-background px-3 py-2">
                  <Spinner className="size-3" />
                  <span className="text-xs text-muted-foreground">
                    Thinking...
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )}
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
              rows={1}
              aria-label="Chat message input"
              className="min-h-9 max-h-[100px] flex-1 resize-none overflow-hidden rounded-lg border bg-background px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
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
 * Controlled port of Cloudflare's mailbox AgentSidebar. The agent panel stays
 * mounted when integrations are selected, preserving warm controller state.
 */
export function MailAgentSidebar(props: MailAgentSidebarProps) {
  return (
    <aside
      aria-label="Mailbox agent"
      className="flex h-full flex-col bg-background"
    >
      <div className="flex shrink-0 items-center border-b">
        <button
          type="button"
          onClick={() => props.onTabChange('agent')}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 border-b-2 bg-transparent px-4 py-2.5 text-sm font-medium transition-colors',
            props.activeTab === 'agent'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Bot className="size-3.5" />
          Agent
        </button>
        <button
          type="button"
          onClick={() => props.onTabChange('integrations')}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 border-b-2 bg-transparent px-4 py-2.5 text-sm font-medium transition-colors',
            props.activeTab === 'integrations'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Plug className="size-3.5" />
          MCP
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={props.activeTab === 'agent' ? 'h-full' : 'hidden'}>
          <MailAgentPanel {...props} />
        </div>
        {props.activeTab === 'integrations' ? props.integrationsPanel : null}
      </div>
    </aside>
  )
}
