import { useEffect, useRef } from 'react'
import { Result } from 'better-result'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { listThreadDocuments } from '@/lib/api'
import {
  isPendingFirstTurn,
  useAgentSessions,
  type AgentChatSession,
} from '../use-agent-chat-sessions'
import { useChatRuntimeConnection } from '../chat-runtime-provider'
import { ConnectedChatPanelInteraction } from './chat-panel-controller'
import { chatThreadKeys } from '../queries'

type ChatHeaderAttachment = {
  href?: string | null
  id: string
  label: string
  meta: string
  source: 'document' | 'file'
  versionId?: string | null
  versionNumber?: number | null
}

const EMPTY_CHAT_HEADER_ATTACHMENTS: ChatHeaderAttachment[] = []

// ChatScrollArea removed — using Conversation from ai-elements

async function fetchThreadDocumentAttachments(threadId: string) {
  const payload = await listThreadDocuments(threadId)
  if (!payload.ok)
    throw new Error(payload.error ?? 'Failed to load attachments')

  return (payload.attachments ?? []).flatMap(
    (document): ChatHeaderAttachment[] => {
      if (!document.id || !document.filename) return []
      return [
        {
          id: document.id,
          label: document.filename,
          meta: document.version_number
            ? `Document V${document.version_number}`
            : document.file_type
              ? document.file_type.toUpperCase()
              : (document.status ?? 'Document'),
          href: document.download_url ?? null,
          source: 'document',
          versionId: document.version_id ?? null,
          versionNumber: document.version_number ?? null,
        },
      ]
    },
  )
}

export function AgentInteractionScreen({
  className,
  panelTitle = 'Agent',
  onClose,
  onSessionChange,
  sessionId = null,
}: {
  className?: string
  panelTitle?: string
  onClose?: () => void
  onSessionChange?: (session: { id: string; title: string }) => void
  sessionId?: string | null
}) {
  const user = useAuthStore((state) => state.user)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const {
    claimWarmSession,
    sessions,
    sessionsQuery,
    updateSessionPreview,
    warmSession,
  } = useAgentSessions()

  const requestedSession = sessionId
    ? sessions.find((session) => session.id === sessionId)
    : null
  const activeSession = sessionId ? requestedSession : warmSession

  const onSessionChangeRef = useRef(onSessionChange)
  const lastPublishedSessionRef = useRef<string | null>(null)

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange
  }, [onSessionChange])

  // Never publish a warm draft: on /chats the warm session resolves
  // immediately, and publishing bounced the composer to /chats/<warmId> —
  // closing that tab re-claimed the still-warm session and reopened it.
  // Publishing waits for the first send; the warm flag rides the dedup key
  // so the flip re-publishes the same id.
  const activeIsWarmDraft = activeSession
    ? isPendingFirstTurn(activeSession)
    : false

  useEffect(() => {
    if (!activeSession) return
    if (activeIsWarmDraft) return
    const nextPublishedSession = `${activeSession.id}:${activeSession.title}`
    if (lastPublishedSessionRef.current === nextPublishedSession) return
    lastPublishedSessionRef.current = nextPublishedSession
    onSessionChangeRef.current?.({
      id: activeSession.id,
      title: activeSession.title,
    })
  }, [activeSession?.id, activeSession?.title, activeIsWarmDraft])

  useEffect(() => {
    if (sessionId || activeSession || sessionsQuery.status !== 'success') {
      return
    }

    // Claim only — the gated effect above owns publishing.
    void Result.tryPromise(() => claimWarmSession()).then((result) => {
      if (Result.isError(result)) {
        console.warn('[chat.screen] failed to claim warm chat', result.error)
      }
    })
  }, [activeSession, claimWarmSession, sessionId, sessionsQuery.status])

  if (!user?.id || !workspace?.id) {
    if (sessionId && sessionsQuery.isPending) {
      return null
    }

    return null
  }

  if (!activeSession) return null

  return (
    <ChatPanelInteraction
      activeSession={activeSession}
      className={className}
      onClose={onClose}
      panelDescription={null}
      panelTitle={panelTitle}
      updateSessionPreview={updateSessionPreview}
    />
  )
}

function ChatPanelInteraction({
  activeSession,
  ...props
}: {
  activeSession: AgentChatSession
  className?: string
  onClose?: () => void
  panelDescription?: string | null
  panelTitle: string
  updateSessionPreview: ReturnType<
    typeof useAgentSessions
  >['updateSessionPreview']
}) {
  const documentAttachmentsQuery = useQuery({
    queryKey: chatThreadKeys.documents(activeSession.id),
    queryFn: () => fetchThreadDocumentAttachments(activeSession.id),
    staleTime: 10_000,
  })
  const runtime = useChatRuntimeConnection({
    session: activeSession,
    updateSessionPreview: props.updateSessionPreview,
  })

  return (
    <ConnectedChatPanelInteraction
      {...props}
      activeSession={activeSession}
      documentAttachments={
        documentAttachmentsQuery.data ?? EMPTY_CHAT_HEADER_ATTACHMENTS
      }
      documentLoadState={
        documentAttachmentsQuery.isPending
          ? 'loading'
          : documentAttachmentsQuery.isError
            ? 'error'
            : 'ready'
      }
      runtime={runtime}
    />
  )
}
