'use client'

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import type { UIMessage } from 'ai'
import { create } from 'zustand'
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

type AgentChatApi = ReturnType<typeof useAgentChat<unknown, ChatUiMessage>>

export type ChatRuntime = {
  addToolApprovalResponse: AgentChatApi['addToolApprovalResponse']
  addToolOutput: AgentChatApi['addToolOutput']
  error: AgentChatApi['error']
  loadRuntimeSkills: () => Promise<ComposerSkill[]>
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
    set((state) => ({
      runtimes: {
        ...state.runtimes,
        [sessionId]: runtime,
      },
    })),
  removeRuntime: (sessionId) =>
    set((state) => {
      if (!state.runtimes[sessionId]) return state
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

export function useChatRuntime(sessionId: string) {
  return useChatRuntimeStore((state) => state.runtimes[sessionId] ?? null)
}

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const { sessions, updateSessionPreview } = useAgentSessions({
    ensureWarmSession: false,
  })
  const runtimeSessions = useMemo(
    () => sessions.filter((session) => !session.archivedAt),
    [sessions],
  )

  return (
    <>
      {runtimeSessions.map((session) => (
        <Suspense key={session.id} fallback={null}>
          <ChatRuntimeConnection
            session={session}
            updateSessionPreview={updateSessionPreview}
          />
        </Suspense>
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
  const setRuntime = useChatRuntimeStore((state) => state.setRuntime)
  const removeRuntime = useChatRuntimeStore((state) => state.removeRuntime)
  const agent = useAgent({
    agent: 'AgentHost',
    name: session.hostName,
    sub: [{ agent: 'WorkspaceAgent', name: session.id }],
  })

  const loadRuntimeSkills = useCallback(
    async () => (await agent.stub.listRuntimeSkills()) as ComposerSkill[],
    [agent],
  )

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
    },
    [session.id, updateSessionPreview],
  )

  const {
    addToolApprovalResponse,
    addToolOutput,
    messages,
    sendMessage,
    status,
    stop,
    error,
  } = useAgentChat<unknown, ChatUiMessage>({
    agent,
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
    },
    onError: markTurnError,
    experimental_throttle: 50,
  })

  const runtime = useMemo<ChatRuntime>(
    () => ({
      addToolApprovalResponse,
      addToolOutput,
      error,
      loadRuntimeSkills,
      markTurnError,
      messages,
      sendMessage,
      setPendingTurn: (pending) => {
        pendingTurnRef.current = pending
      },
      status: status as RealtimeStatus,
      stop,
    }),
    [
      addToolApprovalResponse,
      addToolOutput,
      error,
      loadRuntimeSkills,
      markTurnError,
      messages,
      sendMessage,
      status,
      stop,
    ],
  )

  useEffect(() => {
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
