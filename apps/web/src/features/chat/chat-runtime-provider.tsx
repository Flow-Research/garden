'use client'

import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Result } from 'better-result'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import type { UIMessage } from 'ai'
import { useChatStore } from '@garden/core/chat'
import {
  useAgentSessions,
  type AgentChatSession,
} from './use-agent-chat-sessions'

export type ChatUiMessage = UIMessage
export type RealtimeStatus =
  | 'idle'
  | 'submitted'
  | 'streaming'
  | 'error'
  | 'ready'

export type ComposerSkill = {
  id: string
  slug: string
  name: string
  description: string
}

type PendingTurn = {
  title: string | null
  preview: string
}

type ChatContinuationResult =
  | { ok: true; status: 'completed' | 'skipped' | 'aborted' }
  | { ok: false; error: string }

type AgentChatApi = ReturnType<typeof useAgentChat<unknown, ChatUiMessage>>

export type ChatRuntime = {
  addToolApprovalResponse: AgentChatApi['addToolApprovalResponse']
  addToolOutput: AgentChatApi['addToolOutput']
  error: AgentChatApi['error']
  isRecovering: AgentChatApi['isRecovering']
  isServerStreaming: AgentChatApi['isServerStreaming']
  isStreaming: AgentChatApi['isStreaming']
  continueAfterGardenApproval: (input: {
    approved: boolean
    pendingAgentId?: string | null
    permissionRequestId: string
  }) => Promise<ChatContinuationResult>
  markTurnError: (err: Error) => void
  messages: ChatUiMessage[]
  sendMessage: AgentChatApi['sendMessage']
  setPendingTurn: (pending: PendingTurn | null) => void
  status: RealtimeStatus
  stop: AgentChatApi['stop']
}

function getText(parts: ChatUiMessage['parts']) {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim()
}

export function makeSessionTitle(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return 'New chat'
  return trimmed.length > 48 ? `${trimmed.slice(0, 48).trimEnd()}...` : trimmed
}

function buildSessionPreview(message: ChatUiMessage | undefined) {
  if (!message) return ''
  const text = getText(message.parts)
  if (text) return text
  const fileCount = message.parts.filter((part) => part.type === 'file').length
  return fileCount > 0
    ? `${fileCount} attachment${fileCount === 1 ? '' : 's'}`
    : ''
}

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/**
 * Opens the Cloudflare chat connection directly where the panel consumes it.
 * The old provider registered runtimes through a Zustand side effect and ran a
 * reconnect-recovery loop; durable Think streams already recover server state,
 * so this hook keeps the UI wiring local and effect-free.
 */
export function useChatRuntimeConnection({
  session,
  updateSessionPreview,
}: {
  session: AgentChatSession
  updateSessionPreview: ReturnType<
    typeof useAgentSessions
  >['updateSessionPreview']
}) {
  const pendingTurnRef = useRef<PendingTurn | null>(null)

  const agent = useAgent({
    agent: 'AgentDO',
    connectionTimeout: 30_000,
    name: session.hostName,
    onError: (event) => {
      console.warn('[chat.runtime] websocket connection error', event)
    },
    sub: [{ agent: 'ChatSubAgent', name: session.runtime_key }],
  })

  const markTurnError = useCallback(
    (err: Error) => {
      pendingTurnRef.current = null
      console.warn('[chat.runtime] turn error', err)
      updateSessionPreview({
        sessionId: session.id,
        status: 'error',
        unread: false,
        updatedAt: new Date().toISOString(),
      })
      // Persist the error knowledge to the chat store. `status: 'error'`
      // above is cache-only and gets wiped by the next refetch; the store
      // flag is the durable signal `useAgentSessions` reads when picking a
      // warm session. Without it, a refetched errored chat looks `idle` +
      // placeholder-titled = warm, and `claimWarmSession` will hand the
      // broken thread back as the user's next "New Chat".
      useChatStore.getState().setSessionErrored(session.id, true)
    },
    [session.id, updateSessionPreview],
  )

  const {
    addToolApprovalResponse,
    addToolOutput,
    isRecovering,
    isServerStreaming,
    isStreaming,
    messages,
    sendMessage,
    status,
    stop,
    error,
  } = useAgentChat<unknown, ChatUiMessage>({
    agent,
    getInitialMessages: null,
    onFinish: ({ message }) => {
      const pending = pendingTurnRef.current
      pendingTurnRef.current = null
      const replyPreview = buildSessionPreview(message)
      updateSessionPreview({
        sessionId: session.id,
        ...(pending?.title ? { title: pending.title } : {}),
        lastMessage: replyPreview || pending?.preview || '',
        status: 'idle',
        unread: false,
        updatedAt: new Date().toISOString(),
        persist: true,
      })
      // A successful turn recovers the chat — clear any prior errored mark
      // so it's once again a normal, non-errored chat.
      useChatStore.getState().setSessionErrored(session.id, false)
    },
    onError: markTurnError,
  })

  const stopCurrentTurn = useCallback(async () => {
    const stopResult = await Result.tryPromise(() => stop())
    if (Result.isError(stopResult)) {
      console.warn('[chat.runtime] failed to stop active chat turn', {
        error: stopResult.error,
      })
    }
  }, [stop])

  const runtime = useMemo<ChatRuntime>(
    () => ({
      addToolApprovalResponse,
      addToolOutput,
      error,
      isRecovering,
      isServerStreaming,
      isStreaming,
      continueAfterGardenApproval: async (input) =>
        await agent.call<ChatContinuationResult>(
          'continueAfterGardenApproval',
          [input],
        ),
      markTurnError,
      messages,
      sendMessage,
      setPendingTurn: (pending) => {
        pendingTurnRef.current = pending
      },
      status: status as RealtimeStatus,
      stop: stopCurrentTurn,
    }),
    [
      addToolApprovalResponse,
      addToolOutput,
      error,
      isRecovering,
      isServerStreaming,
      isStreaming,
      agent,
      markTurnError,
      messages,
      sendMessage,
      status,
      stopCurrentTurn,
    ],
  )

  return runtime
}
