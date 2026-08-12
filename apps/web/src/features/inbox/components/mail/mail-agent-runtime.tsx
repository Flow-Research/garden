import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentChatSession } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import {
  useChatRuntimeConnection,
  type ChatUiMessage,
} from '@/features/chat/chat-runtime-provider'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
import { mailAgentSessionOptions, mailKeys } from '../../mail.queries'
import {
  MailAgentSidebar,
  type MailAgentMessage,
  type MailAgentToolState,
} from './mail-agent-sidebar'

const toolState = (state: string): MailAgentToolState => {
  if (state === 'input-streaming' || state === 'input-available') return state
  if (state === 'output-available' || state === 'output-error') return state
  return 'running'
}

/** Projects AI SDK messages into the controlled Cloudflare mailbox panel. */
const mailboxAgentMessages = (
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
      if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') {
        continue
      }
      const namedTool =
        'toolName' in part && typeof part.toolName === 'string'
          ? part.toolName
          : part.type.slice('tool-'.length)
      const state =
        'state' in part && typeof part.state === 'string'
          ? part.state
          : 'running'
      parts.push({
        type: 'tool',
        toolName: namedTool,
        state: toolState(state),
      })
    }
    return [{ id: message.id, role: message.role, parts }]
  })

/**
 * Connects the copied Cloudflare panel to Garden's existing AgentDO chat. The
 * session was authenticated and bound to this conversation on the server; the
 * browser supplies only chat turns and never mailbox scope identifiers.
 */
export function MailAgentRuntime({
  workspaceId,
  conversationId,
  agentName,
  session,
}: {
  workspaceId: string
  conversationId: string
  agentName: string
  session: AgentChatSession
}) {
  const queryClient = useQueryClient()
  const { updateSessionPreview } = useAgentSessions()
  const runtime = useChatRuntimeConnection({
    session,
    updateSessionPreview,
  })
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState<'agent' | 'integrations'>('agent')
  const messages = useMemo(
    () => mailboxAgentMessages(runtime.messages),
    [runtime.messages],
  )

  const send = (text: string) => {
    setInput('')
    runtime.setPendingTurn({ title: null, preview: text })
    void runtime
      .sendMessage({ text })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: mailKeys.conversation(workspaceId, conversationId),
        }),
      )
      .catch((cause: unknown) =>
        runtime.markTurnError(
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      )
  }

  return (
    <MailAgentSidebar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      messages={messages}
      status={runtime.status === 'ready' ? 'idle' : runtime.status}
      input={input}
      onInputChange={setInput}
      onSend={send}
      onStop={() => void runtime.stop()}
      title={agentName}
      integrationsPanel={
        <div className="p-4 text-xs text-muted-foreground">
          Mail tools are scoped to this conversation and mailbox.
        </div>
      }
    />
  )
}

/** Keeps runtime hooks mounted only after the authenticated session exists. */
export function MailAgentConversationPanel({
  workspaceId,
  conversationId,
  agentId,
  agentName,
}: {
  workspaceId: string
  conversationId: string
  agentId: string
  agentName: string
}) {
  const sessionQuery = useQuery(
    mailAgentSessionOptions({ workspaceId, conversationId, agentId }),
  )
  if (sessionQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-4" />
      </div>
    )
  }
  if (sessionQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
        Agent session could not be opened.
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
      agentName={agentName}
      session={sessionQuery.data}
    />
  )
}

/**
 * Creates and binds the selected agent session while the user reads the email.
 * Before this preloader, the first panel click paid the full Postgres + AgentDO
 * binding latency. The shared infinite-stale query now makes opening a cache hit
 * without opening a background chat WebSocket.
 */
export function MailAgentSessionPreloader({
  workspaceId,
  conversationId,
  agentId,
}: {
  workspaceId: string
  conversationId: string
  agentId: string
}) {
  useQuery(mailAgentSessionOptions({ workspaceId, conversationId, agentId }))
  return null
}
