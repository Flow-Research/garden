import { useMemo, useState } from 'react'
import { Result } from 'better-result'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getToolInput,
  getToolOutput,
  getToolPartState,
  type AITool,
} from '@cloudflare/ai-chat/react'
import { getToolName, isToolUIPart, type JSONSchema7 } from 'ai'
import type { AgentChatSession } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { X } from 'lucide-react'
import {
  useChatRuntimeConnection,
  type ChatUiMessage,
} from '@/features/chat/chat-runtime-provider'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
import {
  bindMailAgentContext,
  mailAgentSessionOptions,
  mailKeys,
  resolveMailAgentAction,
  saveAgentMailDraft,
} from '../../mail.queries'
import {
  MailAgentSidebar,
  type MailAgentMessage,
  type MailAgentToolState,
} from './mail-agent-sidebar'
import type { MailAgentComposerDraft } from '@/lib/server/mail-api'
import type {
  AgentMailComposerInput,
  AgentMailComposerOutcome,
} from '../../mail-inbox-controller'

const composeMailParameters: JSONSchema7 = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'body'],
  properties: {
    mode: {
      type: 'string',
      enum: ['new', 'reply', 'reply-all', 'forward'],
      description:
        'Use reply for the open email, reply-all only when all recipients are needed, forward to pass it on, or new for a separate message.',
    },
    to: {
      type: 'string',
      description:
        'Comma-separated recipients. Omit for a reply when Garden can derive them from the open email.',
    },
    cc: { type: 'string', description: 'Optional comma-separated Cc.' },
    bcc: { type: 'string', description: 'Optional comma-separated Bcc.' },
    subject: {
      type: 'string',
      description:
        'Optional subject. Omit for replies when Garden can derive it from the open email.',
    },
    body: {
      type: 'string',
      description: 'Plain-text message body to place in the composer.',
    },
  },
}

/** Maps SDK lifecycle detail onto the mailbox's intentionally small vocabulary. */
const toolState = (
  part: ChatUiMessage['parts'][number],
): MailAgentToolState => {
  const state = getToolPartState(part)
  if (state === 'streaming') return 'input-streaming'
  if (state === 'waiting-approval') return 'waiting-approval'
  if (state === 'complete') return 'output-available'
  if (state === 'error') return 'output-error'
  if (state === 'denied') return 'denied'
  return 'running'
}

/** Projects AI SDK messages into the controlled Cloudflare mailbox panel. */
export const mailboxAgentMessages = (
  messages: ReadonlyArray<ChatUiMessage>,
): ReadonlyArray<MailAgentMessage> =>
  messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const parts: Array<MailAgentMessage['parts'][number]> = []
    for (const part of message.parts) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text })
        continue
      }
      if (!isToolUIPart(part)) continue
      const input = getToolInput(part)
      const output = getToolOutput(part)
      parts.push({
        type: 'tool',
        toolName: getToolName(part),
        state: toolState(part),
        ...(input === undefined ? {} : { input }),
        ...(output === undefined ? {} : { output }),
      })
    }
    return [{ id: message.id, role: message.role, parts }]
  })

/**
 * Connects the copied Cloudflare panel to Garden's existing AgentDO chat. The
 * session identity is stable; immediately before each send the server verifies
 * the untrusted selected-conversation identifier and returns an opaque turn
 * capability. This keeps changing URL context out of SDK-persisted state.
 */
export function MailAgentRuntime({
  workspaceId,
  conversationId,
  session,
  onClose,
  onOpenDraft,
}: {
  workspaceId: string
  conversationId: string | null
  session: AgentChatSession
  onClose?: () => void
  onOpenDraft?: (draft: MailAgentComposerDraft) => AgentMailComposerOutcome
}) {
  const queryClient = useQueryClient()
  const { updateSessionPreview } = useAgentSessions()
  const clientTools = useMemo<Record<string, AITool<unknown, unknown>>>(
    () => ({
      compose_mail: {
        description:
          'Save a proposed message as an agent-authored Garden draft, then open that exact saved revision in the composer for human review. This never sends mail. Use it whenever the user asks to draft, reply, forward, or compose mail.',
        parameters: composeMailParameters,
        execute: async (rawInput) => {
          if (!onOpenDraft) {
            return {
              status: 'unavailable',
              message: 'The Garden composer is not available in this view.',
            }
          }
          const input = rawInput as AgentMailComposerInput & {
            __garden_tool_call_id?: unknown
          }
          if (typeof input.__garden_tool_call_id !== 'string') {
            return {
              status: 'unavailable',
              message: 'This draft is not bound to an active agent turn.',
            }
          }
          const draft = await saveAgentMailDraft({
            data: {
              workspaceId,
              agentId: session.agentId,
              toolCallId: input.__garden_tool_call_id,
            },
          })
          const outcome = onOpenDraft(draft)
          if (outcome.status === 'opened') {
            return {
              status: 'saved_opened',
              message:
                'Draft saved and opened in the composer. The user can review, edit, or send it.',
            }
          }
          return {
            status: 'saved_not_opened',
            message:
              'Draft was saved, but its mailbox is no longer available in this view.',
          }
        },
      },
    }),
    [onOpenDraft, session.agentId, workspaceId],
  )
  const runtime = useChatRuntimeConnection({
    session,
    updateSessionPreview,
    clientTools,
  })
  const [input, setInput] = useState('')
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const messages = useMemo(
    () => mailboxAgentMessages(runtime.messages),
    [runtime.messages],
  )

  const send = (text: string) => {
    const pendingText = text.trim()
    if (!pendingText) return
    setInput('')
    setSubmissionError(null)
    runtime.setPendingTurn({ title: null, preview: pendingText })
    void Result.tryPromise({
      try: async () => {
        const binding = await bindMailAgentContext({
          data: { workspaceId, conversationId, agentId: session.agentId },
        })
        await runtime.sendMessage(
          { text: pendingText },
          { body: { mail_context_token: binding.token } },
        )
        await (conversationId === null
          ? queryClient.invalidateQueries({
              queryKey: mailKeys.all(workspaceId),
            })
          : queryClient.invalidateQueries({
              queryKey: mailKeys.conversation(workspaceId, conversationId),
            }))
      },
      catch: (cause) => cause,
    }).then((result) =>
      result.match({
        ok: () => undefined,
        err: (cause) => {
          setInput((current) => current || pendingText)
          setSubmissionError('Agent context could not be prepared. Try again.')
          runtime.markTurnError(
            cause instanceof Error ? cause : new Error(String(cause)),
          )
        },
      }),
    )
  }

  return (
    <MailAgentSidebar
      messages={messages}
      status={runtime.status === 'ready' ? 'idle' : runtime.status}
      input={input}
      onInputChange={setInput}
      onSend={send}
      onStop={() => void runtime.stop()}
      onClose={onClose}
      onResolveApproval={async (executionId, approved) => {
        const result = await resolveMailAgentAction({
          data: {
            workspaceId,
            executionId,
            action: approved ? 'accept' : 'decline',
          },
        })
        if (result.status === 'approved') {
          await queryClient.invalidateQueries({
            queryKey: mailKeys.all(workspaceId),
          })
        }
        return result.status
      }}
      errorMessage={
        submissionError ??
        (runtime.status === 'error'
          ? 'Agent could not finish. Try again.'
          : undefined)
      }
    />
  )
}

/** Keeps runtime hooks mounted only after the authenticated session exists. */
export function MailAgentConversationPanel({
  workspaceId,
  conversationId,
  agentId,
  onClose,
  onOpenDraft,
}: {
  workspaceId: string
  conversationId: string | null
  agentId: string
  onClose?: () => void
  onOpenDraft?: (draft: MailAgentComposerDraft) => AgentMailComposerOutcome
}) {
  const ownerUserId = useAuthStore((state) => state.user?.id ?? null)
  const sessionQuery = useQuery(
    mailAgentSessionOptions({ workspaceId, agentId, ownerUserId }),
  )
  if (sessionQuery.isPending) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 top-2"
            onClick={onClose}
            aria-label="Close agent"
          >
            <X />
          </Button>
        ) : null}
        <Spinner className="size-4" />
        <span>Loading agent...</span>
      </div>
    )
  }
  if (sessionQuery.isError) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 top-2"
            onClick={onClose}
            aria-label="Close agent"
          >
            <X />
          </Button>
        ) : null}
        <span>Agent session could not be opened.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => sessionQuery.refetch()}
        >
          Retry
        </Button>
      </div>
    )
  }
  return (
    <MailAgentRuntime
      workspaceId={workspaceId}
      conversationId={conversationId}
      session={sessionQuery.data}
      onClose={onClose}
      onOpenDraft={onOpenDraft}
    />
  )
}
