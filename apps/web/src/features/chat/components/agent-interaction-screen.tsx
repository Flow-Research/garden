import { useEffect, useRef } from 'react'
import { Result } from 'better-result'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { listThreadDocuments } from '@/lib/api'
import { useSidebar } from '@garden/ui/components/ui/sidebar'
import {
  useAgentSessions,
  type AgentChatSession,
} from '../use-agent-chat-sessions'
import { useChatRuntimeConnection } from '../chat-runtime-provider'
import { ConnectedChatPanelInteraction } from './chat-panel-controller'

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
  const { state: sidebarState, toggleSidebar } = useSidebar()
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

  useEffect(() => {
    if (!activeSession) return
    const nextPublishedSession = `${activeSession.id}:${activeSession.title}`
    if (lastPublishedSessionRef.current === nextPublishedSession) return
    lastPublishedSessionRef.current = nextPublishedSession
    onSessionChangeRef.current?.({
      id: activeSession.id,
      title: activeSession.title,
    })
  }, [activeSession?.id, activeSession?.title])

  useEffect(() => {
    if (sessionId || activeSession || sessionsQuery.status !== 'success') {
      return
    }

    void Result.tryPromise(() => claimWarmSession()).then((result) => {
      if (Result.isError(result)) {
        console.warn('[chat.screen] failed to claim warm chat', result.error)
        return
      }
      onSessionChangeRef.current?.({
        id: result.value.id,
        title: result.value.title,
      })
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
      sidebarState={sidebarState}
      toggleSidebar={toggleSidebar}
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
  sidebarState: 'collapsed' | 'expanded'
  toggleSidebar: () => void
  updateSessionPreview: ReturnType<
    typeof useAgentSessions
  >['updateSessionPreview']
}) {
  const documentAttachmentsQuery = useQuery({
    queryKey: ['chat-thread-documents', activeSession.id],
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
      runtime={runtime}
    />
  )
}
