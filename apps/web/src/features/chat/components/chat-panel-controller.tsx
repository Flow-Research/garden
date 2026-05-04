'use client'

/**
 * `ConnectedChatPanelInteraction` — the data-bound controller for the chat
 * panel. Wires runtime, sessions, and dock state to render a working
 * conversation surface.
 *
 * Extracted from `agent-interaction-screen.tsx` to keep the parent file
 * focused on the bare AgentInteractionScreen scaffold + ShellFrame chrome.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Result } from 'better-result'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@garden/core/chat'
import { useWorkspaceStore } from '@garden/core/workspace'
import { Alert, AlertDescription, AlertTitle } from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { EnvironmentDebugDrawer } from '@/features/settings/components/environment-debug-drawer'
import { usePrefetchDebugStream } from '@/features/settings/components/use-debug-stream'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import {
  useAgentSessions,
  type AgentChatSession,
  NEW_SESSION_TITLE,
} from '../use-agent-chat-sessions'
import {
  makeSessionTitle,
  type ChatRuntime,
} from '../chat-runtime-provider'
import {
  DocumentSidePanel,
  withDocumentVersionUrl,
  type DocumentCitationAnnotation,
  type DocumentEditAnnotation,
  type DocumentPanelView,
} from './chat-document-panel'
import {
  type ApprovalGroup,
  type DocumentEditStatusMap,
} from './chat-message-parts'
import { resolveToolApproval } from './chat-tool-activity'
import {
  Composer,
  createFileList,
  normalizeStatus,
  shouldPersistAsDocument,
  uploadAgentDocuments,
} from './chat-composer'
import {
  buildMessageHeaderAttachments,
  type ChatHeaderAttachment,
} from './chat-message-files'
import type { GardenArtifactData } from '@/features/artifacts/artifact-renderer'
import type {
  StructuredQuestion,
  StructuredQuestionAnswers,
} from '@garden/core/chat'
import { isToolUIPart, getToolName } from 'ai'
import {
  getToolCallId,
  getToolInput,
} from '@cloudflare/ai-chat/react'
import {
  Suggestions,
  Suggestion as SuggestionChip,
} from '@/components/ai-elements/suggestion'
import { ChatTimeline } from './chat-timeline'
import { X } from 'lucide-react'
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react'
import { HeaderAttachmentsMenu } from './chat-message-files'

export function ConnectedChatPanelInteraction({
  activeSession,
  className,
  documentAttachments,
  onClose,
  panelDescription,
  panelTitle,
  runtime,
  sidebarState,
  toggleSidebar,
  updateSessionPreview,
}: {
  activeSession: AgentChatSession
  className?: string
  documentAttachments: ChatHeaderAttachment[]
  onClose?: () => void
  panelDescription?: string | null
  panelTitle: string
  runtime: ChatRuntime
  sidebarState: 'collapsed' | 'expanded'
  toggleSidebar: () => void
  updateSessionPreview: ReturnType<
    typeof useAgentSessions
  >['updateSessionPreview']
}) {
  const sessionId = activeSession.id
  const queryClient = useQueryClient()
  const debugModeEnabled = useDevSettingsStore((s) => s.debugMode)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null)
  usePrefetchDebugStream({
    enabled: debugModeEnabled,
    workspaceId,
    sessionId,
  })

  // Composer text is stored in the chat store (workspace-namespaced, persisted
  // via zustand `persist`) so a typed-but-unsent draft survives reloads, tab
  // switches, and panel close/reopen — keyed per session id.
  const input = useChatStore((s) => s.inputDrafts[sessionId] ?? '')
  const setInputDraftFn = useChatStore((s) => s.setInputDraft)
  const clearInputDraftFn = useChatStore((s) => s.clearInputDraft)
  const setInput = useCallback(
    (value: string) => {
      if (value === '') {
        clearInputDraftFn(sessionId)
      } else {
        setInputDraftFn(sessionId, value)
      }
    },
    [sessionId, setInputDraftFn, clearInputDraftFn],
  )
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [resolvingToolCallIds, setResolvingToolCallIds] = useState<string[]>([])
  const [isRetrying, setIsRetrying] = useState(false)
  const [documentPanelView, setDocumentPanelView] =
    useState<DocumentPanelView | null>(null)
  const [resolvedDocumentEditStatuses, setResolvedDocumentEditStatuses] =
    useState<DocumentEditStatusMap>({})
  const [optimisticPendingTurn, setOptimisticPendingTurn] = useState(false)
  const lastSentTextRef = useRef<string | null>(null)
  const pendingMessageCountRef = useRef<number | null>(null)
  const wasActiveSessionRef = useRef(false)
  const [timelineActivationCount, setTimelineActivationCount] = useState(0)
  const {
    addToolApprovalResponse,
    addToolOutput,
    error,
    markTurnError,
    messages,
    sendMessage,
    status,
    stop,
    isStreaming,
  } = runtime

  useLayoutEffect(() => {
    const isActiveSession = activeSessionId === sessionId
    if (isActiveSession && !wasActiveSessionRef.current) {
      setTimelineActivationCount((count) => count + 1)
    }
    wasActiveSessionRef.current = isActiveSession
  }, [activeSessionId, sessionId])

  const timelineInitialScrollKey = `${sessionId}:${timelineActivationCount}`

  useEffect(() => {
    if (normalizeStatus(status) !== 'idle') {
      setOptimisticPendingTurn(false)
      pendingMessageCountRef.current = null
      return
    }
    if (
      pendingMessageCountRef.current !== null &&
      messages.length > pendingMessageCountRef.current
    ) {
      setOptimisticPendingTurn(false)
      pendingMessageCountRef.current = null
    }
  }, [messages.length, status])

  const handleSend = async ({
    text,
    files,
  }: {
    text: string
    files: File[]
  }) => {
    lastSentTextRef.current = text
    pendingMessageCountRef.current = messages.length
    setOptimisticPendingTurn(true)
    const documentFiles = files.filter(shouldPersistAsDocument)
    const passthroughFiles = files.filter(
      (file) => !shouldPersistAsDocument(file),
    )

    // Stash what the turn would eventually commit so onFinish/onError can
    // apply (or drop) it. We deliberately do NOT rename the sidebar entry
    // here — it'd flash before the reply, and errors would strand a rename
    // we never asked for.
    const nextTitle =
      activeSession.title === NEW_SESSION_TITLE && text
        ? makeSessionTitle(text)
        : null
    runtime.setPendingTurn({
      title: nextTitle,
      preview: text,
    })

    updateSessionPreview({
      sessionId: activeSession.id,
      status: 'submitted',
      unread: false,
      updatedAt: new Date().toISOString(),
    })

    const uploadResult =
      documentFiles.length > 0
        ? await uploadAgentDocuments({
            files: documentFiles,
            threadId: sessionId,
          })
        : Result.ok([])

    if (uploadResult.isErr()) {
      setOptimisticPendingTurn(false)
      pendingMessageCountRef.current = null
      markTurnError(uploadResult.error)
      return
    }
    if (uploadResult.value.length > 0) {
      void queryClient.invalidateQueries({
        queryKey: ['chat-thread-documents', sessionId],
      })
    }

    const documentContext =
      uploadResult.value.length > 0
        ? `The user uploaded these workspace documents for this turn. Internal document handles for this turn follow. Use these handles only in document tool calls. Do not mention handles, ids, or UUIDs to the user; refer to documents by filename:\n${uploadResult.value
            .map(
              (document) =>
                `- handle: ${document.document_id}; filename: ${document.filename}${
                  document.version_number
                    ? ` (V${document.version_number})`
                    : ''
                }`,
            )
            .join('\n')}`
        : ''
    const requestOptions = documentContext
      ? {
          body: {
            document_context: documentContext,
          },
        }
      : undefined

    const result = await Result.tryPromise(() =>
      sendMessage(
        passthroughFiles.length > 0
          ? { text, files: createFileList(passthroughFiles) }
          : { text },
        requestOptions,
      ),
    )

    if (Result.isError(result)) {
      setOptimisticPendingTurn(false)
      pendingMessageCountRef.current = null
      // If send rejects before streaming begins, surface it through the
      // workspace runtime so the composer does not hang in `submitted`.
      markTurnError(
        result.error instanceof Error
          ? result.error
          : new Error(String(result.error)),
      )
    }
  }

  const handleRetry = useCallback(async () => {
    const text = lastSentTextRef.current
    if (!text) return
    setIsRetrying(true)
    await handleSend({ text, files: [] })
    setIsRetrying(false)
  }, [])

  const handleResolveToolApproval = useCallback(
    async (group: ApprovalGroup, approved: boolean) => {
      setApprovalError(null)
      setResolvingToolCallIds((current) => [
        ...new Set([...current, ...group.toolCallIds]),
      ])

      const result = await resolveToolApproval({
        approved,
        threadId: sessionId,
        toolCallId: group.toolCallIds[0] ?? '',
      }).catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : 'Failed to resolve approval'
        setApprovalError(message)
        return null
      })

      if (result) {
        const resolvedToolCallIds = new Set(result.toolCallIds)
        group.toolCallIds.forEach((toolCallId, index) => {
          if (
            resolvedToolCallIds.size > 0 &&
            !resolvedToolCallIds.has(toolCallId)
          ) {
            return
          }

          const approvalId = group.approvalIds[index]
          if (!approvalId) {
            return
          }

          addToolApprovalResponse?.({
            id: approvalId,
            approved,
          })
        })
      }

      setResolvingToolCallIds((current) =>
        current.filter((toolCallId) => !group.toolCallIds.includes(toolCallId)),
      )
    },
    [addToolApprovalResponse, sessionId],
  )

  // ── Structured input: detect pending askUserInput tool parts ──────────
  // Walk messages backward to find the latest askUserInput tool call
  // waiting for the user's selection. The AI SDK surfaces client-side
  // tools (no execute) with state "input-available".
  const pendingStructuredInput = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message || message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue
        if (getToolName(part) !== 'askUserInput') continue
        if ((part as { state: string }).state !== 'input-available') continue
        const input = getToolInput(part) as
          | { questions?: StructuredQuestion[] }
          | undefined
        if (input?.questions && input.questions.length > 0) {
          return {
            toolCallId: getToolCallId(part),
            questions: input.questions,
          }
        }
      }
    }
    return null
  }, [messages])

  const handleSubmitAnswers = useCallback(
    (answers: StructuredQuestionAnswers) => {
      if (!pendingStructuredInput || !addToolOutput) return
      addToolOutput({
        toolCallId: pendingStructuredInput.toolCallId,
        output: answers,
      })
    },
    [addToolOutput, pendingStructuredInput],
  )

  const sessionIsFresh =
    isUnusedIdleSession(activeSession) && messages.length === 0

  const currentTitle = sessionIsFresh ? panelTitle : activeSession.title
  const visibleMessages = sessionIsFresh ? [] : messages
  const headerAttachments = useMemo(() => {
    const seenDocuments = new Set(
      documentAttachments.map((attachment) => attachment.id),
    )
    const messageFiles = buildMessageHeaderAttachments(visibleMessages).filter(
      (attachment) => !seenDocuments.has(attachment.id),
    )
    return [...documentAttachments, ...messageFiles]
  }, [documentAttachments, visibleMessages])

  const openDocumentArtifact = useCallback((artifact: GardenArtifactData) => {
    setDocumentPanelView({
      artifact,
      kind: 'document',
    })
  }, [])

  const openDocumentAttachment = useCallback(
    (attachment: ChatHeaderAttachment) => {
      if (attachment.source === 'file') {
        if (attachment.href)
          window.open(attachment.href, '_blank', 'noreferrer')
        return
      }

      openDocumentArtifact({
        kind: 'document',
        id: attachment.id,
        filename: attachment.label,
        title: attachment.label,
        url: attachment.href ?? null,
        versionId: attachment.versionId ?? null,
        versionNumber: attachment.versionNumber ?? null,
      })
    },
    [openDocumentArtifact],
  )

  const openDocumentEdit = useCallback(
    (annotation: DocumentEditAnnotation, artifact: GardenArtifactData) => {
      setDocumentPanelView({
        annotation: {
          ...annotation,
          status:
            resolvedDocumentEditStatuses[annotation.edit_id] ??
            annotation.status,
        },
        artifact,
        kind: 'edit',
      })
    },
    [resolvedDocumentEditStatuses],
  )

  const openDocumentCitation = useCallback(
    (citation: DocumentCitationAnnotation) => {
      setDocumentPanelView({
        artifact: {
          kind: 'document',
          id: citation.document_id,
          filename: citation.filename,
          title: citation.filename,
          url: withDocumentVersionUrl(
            `/api/documents/${citation.document_id}/docx?filename=${encodeURIComponent(citation.filename)}`,
            citation.version_id ?? null,
          ),
          versionId: citation.version_id ?? null,
          versionNumber: citation.version_number ?? null,
        },
        citation,
        kind: 'citation',
      })
    },
    [],
  )

  const handleDocumentEditResolved = useCallback(
    (editId: string, status: 'accepted' | 'rejected') => {
      setResolvedDocumentEditStatuses((current) => ({
        ...current,
        [editId]: status,
      }))
      setDocumentPanelView((current) => {
        if (current?.kind !== 'edit' || current.annotation.edit_id !== editId) {
          return current
        }
        return {
          ...current,
          annotation: {
            ...current.annotation,
            status,
          },
        }
      })
      void queryClient.invalidateQueries({
        queryKey: ['chat-thread-documents', sessionId],
      })
    },
    [queryClient, sessionId],
  )
  const handleDocumentEditResolveStart = useCallback(
    (editId: string, status: 'accepted' | 'rejected') => {
      setResolvedDocumentEditStatuses((current) => ({
        ...current,
        [editId]: status,
      }))
    },
    [],
  )
  const handleDocumentEditResolveError = useCallback((editId: string) => {
    setResolvedDocumentEditStatuses((current) => {
      const { [editId]: removed, ...rest } = current
      void removed
      return rest
    })
  }, [])

  const closeDocumentPanel = useCallback(() => {
    setDocumentPanelView(null)
  }, [])

  return (
    <ShellFrame
      attachments={headerAttachments}
      className={className}
      panelTitle={currentTitle}
      panelDescription={panelDescription}
      onClose={onClose}
      sessionId={sessionId}
      sidebarState={sidebarState}
      onToggleSidebar={toggleSidebar}
      onOpenAttachment={openDocumentAttachment}
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {approvalError ? (
            <div className="shrink-0 border-b px-5 py-3">
              <Alert variant="destructive">
                <AlertTitle>Approval error</AlertTitle>
                <AlertDescription>{approvalError}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          <ChatTimeline
            debugMode={debugModeEnabled}
            initialScrollKey={timelineInitialScrollKey}
            sessionId={sessionId}
            messages={visibleMessages}
            error={error ?? null}
            status={status}
            onOpenDocument={openDocumentArtifact}
            onOpenEdit={openDocumentEdit}
            onOpenCitation={openDocumentCitation}
            onDocumentEditResolveError={handleDocumentEditResolveError}
            onDocumentEditResolveStart={handleDocumentEditResolveStart}
            onDocumentEditResolved={handleDocumentEditResolved}
            onResolveToolApproval={handleResolveToolApproval}
            resolvedDocumentEditStatuses={resolvedDocumentEditStatuses}
            resolvingToolCallIds={resolvingToolCallIds}
            onRetry={handleRetry}
            isRetrying={isRetrying}
            forcePendingActivity={optimisticPendingTurn}
          />
          {visibleMessages.length === 0 && normalizeStatus(status) === 'idle' ? (
            <div className="shrink-0 px-4 pb-2">
              <div className="mx-auto max-w-2xl">
                <Suggestions>
                  <SuggestionChip
                    suggestion="Summarize recent documents"
                    onClick={(s) => setInput(s)}
                  />
                  <SuggestionChip
                    suggestion="Help me draft a document"
                    onClick={(s) => setInput(s)}
                  />
                  <SuggestionChip
                    suggestion="What can you help me with?"
                    onClick={(s) => setInput(s)}
                  />
                </Suggestions>
              </div>
            </div>
          ) : null}
          <Composer
            agentId={activeSession.agentId}
            isStreaming={isStreaming}
            status={status}
            input={input}
            onInputChange={setInput}
            onSend={handleSend}
            onStop={stop}
            pendingQuestions={pendingStructuredInput?.questions}
            onSubmitAnswers={handleSubmitAnswers}
          />
        </div>
        <DocumentSidePanel
          onClose={closeDocumentPanel}
          onEditResolved={handleDocumentEditResolved}
          view={documentPanelView}
        />
      </div>
    </ShellFrame>
  )
}

function isUnusedIdleSession(session: AgentChatSession | null) {
  if (!session) return false
  return (
    session.title.trim().toLowerCase() === 'new chat' &&
    session.lastMessage.trim().length === 0 &&
    session.status === 'idle' &&
    !session.archivedAt
  )
}

function ShellFrame({
  attachments = [],
  children,
  className,
  onClose,
  onOpenAttachment,
  onToggleSidebar,
  panelDescription,
  panelTitle,
  sessionId = null,
  sidebarState,
}: {
  attachments?: ChatHeaderAttachment[]
  children: React.ReactNode
  className?: string
  onClose?: () => void
  onOpenAttachment?: (attachment: ChatHeaderAttachment) => void
  onToggleSidebar: () => void
  panelDescription?: string | null
  panelTitle: string
  sessionId?: string | null
  sidebarState: 'collapsed' | 'expanded'
}) {
  const debugMode = useDevSettingsStore((s) => s.debugMode)

  return (
    <section
      className={cn('flex h-full min-h-0 flex-col bg-background', className)}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSidebar}
              aria-label={
                sidebarState === 'expanded'
                  ? 'Collapse sidebar'
                  : 'Expand sidebar'
              }
              title={
                sidebarState === 'expanded'
                  ? 'Collapse sidebar'
                  : 'Expand sidebar'
              }
            >
              {sidebarState === 'expanded' ? (
                <IconLayoutSidebarLeftCollapse className="size-4" />
              ) : (
                <IconLayoutSidebarLeftExpand className="size-4" />
              )}
            </Button>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold">
                  {panelTitle}
                </div>
                <HeaderAttachmentsMenu
                  attachments={attachments}
                  onOpenAttachment={onOpenAttachment}
                />
              </div>
              {panelDescription ? (
                <div className="truncate text-xs text-muted-foreground">
                  {panelDescription}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {debugMode ? (
              <EnvironmentDebugDrawer sessionId={sessionId} />
            ) : null}
            {onClose ? (
              <Button variant="ghost" size="icon-sm" onClick={onClose}>
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
        {children}
      </div>
    </section>
  )
}

