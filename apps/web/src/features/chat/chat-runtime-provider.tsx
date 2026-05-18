'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { Result } from 'better-result'
import { useAgent } from 'agents/react'
import { getToolPartState, useAgentChat } from '@cloudflare/ai-chat/react'
import { isToolUIPart, type UIMessage } from 'ai'
import { create } from 'zustand'
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

type ChatRuntimeStore = {
  removeRuntime: (sessionId: string) => void
  runtimes: Record<string, ChatRuntime | undefined>
  setRuntime: (sessionId: string, runtime: ChatRuntime) => void
}

const useChatRuntimeStore = create<ChatRuntimeStore>((set) => ({
  runtimes: {},
  setRuntime: (sessionId, runtime) =>
    set((state) => {
      if (state.runtimes[sessionId] === runtime) return state
      return {
        runtimes: {
          ...state.runtimes,
          [sessionId]: runtime,
        },
      }
    }),
  removeRuntime: (sessionId) =>
    set((state) => {
      if (!state.runtimes[sessionId]) {
        return state
      }
      const next = { ...state.runtimes }
      delete next[sessionId]
      return { runtimes: next }
    }),
}))

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

function getAgentStreamEvent(data: unknown) {
  if (!data || typeof data !== 'object') return null
  const event = data as {
    done?: unknown
    error?: unknown
    id?: unknown
    type?: unknown
  }
  if (typeof event.type !== 'string') return null
  return {
    done: event.done === true,
    error: Boolean(event.error),
    id: typeof event.id === 'string' ? event.id : null,
    type: event.type,
  }
}

function getLatestAssistantMessage(messages: ChatUiMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant')
}

function hasInterruptedToolCall(message: ChatUiMessage | undefined) {
  if (!message) return false

  return message.parts.some((part) => {
    if (!isToolUIPart(part)) return false
    const state = String(getToolPartState(part))
    return (
      state !== 'output-available' &&
      state !== 'output-error' &&
      state !== 'waiting-approval'
    )
  })
}

export function useChatRuntime(sessionId: string) {
  return useChatRuntimeStore((state) => state.runtimes[sessionId] ?? null)
}

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const { sessions, updateSessionPreview } = useAgentSessions()
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const visibleChatSessionIds = useChatStore(
    (state) => state.visibleChatSessionIds,
  )
  const visibleChatSessionIdSet = useMemo(
    () => new Set(visibleChatSessionIds),
    [visibleChatSessionIds],
  )
  const runtimeSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !session.archivedAt &&
          !session.optimistic &&
          (session.id === activeSessionId ||
            visibleChatSessionIdSet.has(session.id)),
      ),
    [activeSessionId, sessions, visibleChatSessionIdSet],
  )

  return (
    <>
      {runtimeSessions.map((session) => (
        <ChatRuntimeConnection
          key={session.id}
          session={session}
          updateSessionPreview={updateSessionPreview}
        />
      ))}
      {children}
    </>
  )
}

function ChatRuntimeConnection({
  session,
  updateSessionPreview,
}: {
  session: AgentChatSession
  updateSessionPreview: ReturnType<
    typeof useAgentSessions
  >['updateSessionPreview']
}) {
  const pendingTurnRef = useRef<PendingTurn | null>(null)
  const activeStreamIdsRef = useRef(new Set<string>())
  const needsReconnectRecoveryRef = useRef(false)
  const recoveringRef = useRef(false)
  const recoveredAssistantIdsRef = useRef(new Set<string>())
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setRuntime = useChatRuntimeStore((state) => state.setRuntime)
  const removeRuntime = useChatRuntimeStore((state) => state.removeRuntime)

  const agent = useAgent({
    agent: 'AgentDO',
    connectionTimeout: 30_000,
    name: session.hostName,
    onClose: () => {
      needsReconnectRecoveryRef.current = true
    },
    onError: (event) => {
      needsReconnectRecoveryRef.current = true
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
    isServerStreaming,
    isStreaming,
    messages,
    sendMessage,
    setMessages,
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
    experimental_throttle: 50,
  })

  const recoverInterruptedTurn = useCallback(() => {
    if (!needsReconnectRecoveryRef.current) return
    if (recoveringRef.current) return
    if (isStreaming) return
    if (status !== 'ready') return

    const assistant = getLatestAssistantMessage(messages)
    if (!assistant || !hasInterruptedToolCall(assistant)) return
    const assistantId = assistant.id
    if (recoveredAssistantIdsRef.current.has(assistantId)) return

    recoveredAssistantIdsRef.current.add(assistantId)
    recoveringRef.current = true
    updateSessionPreview({
      sessionId: session.id,
      status: 'streaming',
      unread: false,
      updatedAt: new Date().toISOString(),
    })

    void Result.tryPromise(() =>
      agent.call<ChatContinuationResult>('recoverInterruptedTurn'),
    ).then((result) => {
      recoveringRef.current = false
      if (Result.isError(result)) {
        recoveredAssistantIdsRef.current.delete(assistantId)
        console.warn('[chat.runtime] reconnect recovery failed', result.error)
        return
      }
      if (!result.value.ok) {
        recoveredAssistantIdsRef.current.delete(assistantId)
        console.warn(
          '[chat.runtime] reconnect recovery skipped',
          result.value.error,
        )
        return
      }
      needsReconnectRecoveryRef.current = false
    })
  }, [agent, isStreaming, messages, session.id, status, updateSessionPreview])

  const scheduleReconnectRecovery = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current)
    }
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null
      recoverInterruptedTurn()
    }, 250)
  }, [recoverInterruptedTurn])

  useEffect(() => {
    recoverInterruptedTurn()
  }, [recoverInterruptedTurn])

  useEffect(() => {
    const onAgentMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      const parsed = Result.try(() => JSON.parse(event.data) as unknown)
      if (Result.isError(parsed)) return
      const sessionEvent = parsed.value as { phase?: unknown; type?: unknown }
      if (
        sessionEvent.type === 'cf_agent_session' &&
        sessionEvent.phase === 'idle'
      ) {
        scheduleReconnectRecovery()
        return
      }

      const streamEvent = getAgentStreamEvent(parsed.value)
      if (!streamEvent) return

      if (streamEvent.type === 'cf_agent_chat_clear') {
        activeStreamIdsRef.current.clear()
        setMessages([])
        return
      }

      if (
        streamEvent.type !== 'cf_agent_stream_resuming' &&
        streamEvent.type !== 'cf_agent_use_chat_response'
      ) {
        return
      }

      if (!streamEvent.id) return
      if (streamEvent.done || streamEvent.error) {
        activeStreamIdsRef.current.delete(streamEvent.id)
        return
      }
      activeStreamIdsRef.current.add(streamEvent.id)
    }

    agent.addEventListener('message', onAgentMessage)
    return () => {
      agent.removeEventListener('message', onAgentMessage)
      activeStreamIdsRef.current.clear()
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
    }
  }, [agent, scheduleReconnectRecovery, setMessages])

  const stopCurrentTurn = useCallback(async () => {
    const streamIds = [...activeStreamIdsRef.current]
    activeStreamIdsRef.current.clear()

    streamIds.forEach((id) => {
      const sendResult = Result.try(() =>
        agent.send(
          JSON.stringify({
            id,
            type: 'cf_agent_chat_request_cancel',
          }),
        ),
      )
      if (Result.isError(sendResult)) {
        console.warn('[chat.runtime] failed to send stream cancel', {
          id,
          error: sendResult.error,
        })
      }
    })

    const stopResult = await Result.tryPromise(() => stop())
    if (Result.isError(stopResult)) {
      console.warn('[chat.runtime] failed to stop active chat turn', {
        error: stopResult.error,
      })
    }
  }, [agent, stop])

  const runtime = useMemo<ChatRuntime>(
    () => ({
      addToolApprovalResponse,
      addToolOutput,
      error,
      isServerStreaming,
      isStreaming,
      continueAfterGardenApproval: async (input) =>
        await agent.call<ChatContinuationResult>('continueAfterGardenApproval', [
          input,
        ]),
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

  useLayoutEffect(() => {
    setRuntime(session.id, runtime)
  }, [runtime, session.id, setRuntime])

  useEffect(
    () => () => {
      removeRuntime(session.id)
    },
    [removeRuntime, session.id],
  )

  return null
}
