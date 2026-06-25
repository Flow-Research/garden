import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Result } from 'better-result'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import type { UIMessage } from 'ai'
import { useAuthStore } from '@garden/app-state/auth'
import { useChatStore } from '@garden/app-state/chat'
import { useWorkspaceStore } from '@garden/app-state/workspace'
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
type WarmRuntimeResult = { ok: true } | { ok: false; error: string }

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
  warmRuntime: () => void
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

function ChatRuntimeWarmConnection({ session }: { session: AgentChatSession }) {
  const agent = useAgent({
    agent: 'AgentDO',
    connectionTimeout: 30_000,
    name: session.hostName,
    onError: (event) => {
      console.warn('[chat.runtime] warm parent websocket error', event)
    },
  })
  useAgent({
    agent: 'AgentDO',
    connectionTimeout: 30_000,
    name: session.hostName,
    onError: (event) => {
      console.warn('[chat.runtime] warm chat websocket error', event)
    },
    sub: [{ agent: 'ChatSubAgent', name: session.runtime_key }],
  })

  useQuery({
    queryKey: [
      'chat-runtime-warm-hidden',
      session.hostName,
      session.runtime_key,
    ],
    queryFn: async () => {
      const result = await agent.call<WarmRuntimeResult>(
        'warmThreadRuntime',
        [session.runtime_key],
      )
      if (!result.ok) throw new Error(result.error)
      return true
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  })

  return null
}

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const workspaceId = useWorkspaceStore((state) => state.workspace?.id ?? null)
  const visibleChatSessionIds = useChatStore(
    (state) => state.visibleChatSessionIds,
  )
  const { claimWarmSession, sessionsQuery, warmSession } = useAgentSessions()
  const warmSessionQuery = useQuery({
    queryKey: [
      'chat-runtime-warm-session',
      workspaceId,
      userId,
      warmSession?.id ?? 'missing',
      sessionsQuery.data?.length ?? 0,
    ],
    queryFn: claimWarmSession,
    enabled:
      Boolean(workspaceId && userId) &&
      sessionsQuery.status === 'success' &&
      !warmSession,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  })
  const warmCandidate = warmSession ?? warmSessionQuery.data ?? null
  /**
   * Do not keep the hidden prewarm socket open for a chat that already has a
   * visible panel runtime. Before this guard, an idle new chat could hold two
   * parent AgentDO sockets and two ChatSubAgent sockets: one hidden warmer plus
   * one visible `useChatRuntimeConnection`. Afterward prewarm is only for the
   * next unopened session, reducing idle websocket/facet/MCP pressure. Source
   * checked: local Agents SDK `useAgent` / `useAgentChat` connection lifecycle.
   */
  const sessionToWarm =
    warmCandidate && !visibleChatSessionIds.includes(warmCandidate.id)
      ? warmCandidate
      : null

  return (
    <>
      {sessionToWarm ? (
        <ChatRuntimeWarmConnection session={sessionToWarm} />
      ) : null}
      {children}
    </>
  )
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

  const parentAgent = useAgent({
    agent: 'AgentDO',
    connectionTimeout: 30_000,
    name: session.hostName,
    onError: (event) => {
      console.warn('[chat.runtime] parent websocket connection error', event)
    },
  })
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

  // Latest `sendMessage` for use inside `onFinish` (which closes over this
  // render's config but runs after the hook returns). A ref avoids a stale
  // binding without threading `sendMessage` through deps.
  const sendMessageRef = useRef<AgentChatApi['sendMessage'] | null>(null)

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

      // Drain follow-ups the user staged while this turn was streaming, as ONE
      // combined turn.
      //
      // We deliberately combine client-side rather than fire N separate sends
      // and lean on the server's `messageConcurrency = 'merge'`. Reading the
      // SDK (`AIChatAgent._getSubmitConcurrencyDecision` / `_mergeQueuedUserMessages`):
      // merge only collapses a *contiguous run of ≥2 overlapping* user messages
      // within one turn-queue generation, and the submit that *initiates* a turn
      // is not part of that run. Firing N sends from idle would make the first
      // start its own turn while only the rest overlap — so two queued messages
      // would yield two separate turns (a run of 1 never merges). Joining the
      // texts with the same `\n\n` separator `_mergeUserMessages` uses gives the
      // intended single combined turn deterministically, with no timing race.
      //
      // Deferred to a microtask so the send happens *after* this onFinish frame
      // unwinds — calling `sendMessage` re-entrantly while the SDK is still
      // finalizing the just-finished stream risks dropping the submit.
      const queued = useChatStore.getState().takeQueuedMessages(session.id)
      if (queued.length > 0) {
        const combined = queued.map((item) => item.text).join('\n\n')
        pendingTurnRef.current = { title: null, preview: combined }
        queueMicrotask(() => {
          void sendMessageRef.current?.({ text: combined })
        })
      }
    },
    onError: markTurnError,
  })

  sendMessageRef.current = sendMessage

  const warmInFlightRef = useRef<Promise<void> | null>(null)
  const warmRuntime = useCallback(() => {
    if (warmInFlightRef.current) return

    warmInFlightRef.current = parentAgent
      .call<WarmRuntimeResult>('warmThreadRuntime', [session.runtime_key])
      .then((result) => {
        if (!result.ok) {
          console.warn('[chat.runtime] warm failed', result.error)
        }
      })
      .catch((error: unknown) => {
        console.warn('[chat.runtime] warm failed', error)
      })
      .finally(() => {
        warmInFlightRef.current = null
      })
  }, [agent, parentAgent])

  useQuery({
    queryKey: ['chat-runtime-warm', session.hostName, session.runtime_key],
    queryFn: async () => {
      warmRuntime()
      await (warmInFlightRef.current ?? Promise.resolve())
      return true
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
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
      warmRuntime,
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
      warmRuntime,
    ],
  )

  return runtime
}
