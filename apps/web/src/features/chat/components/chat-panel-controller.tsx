'use client'

/**
 * `ConnectedChatPanelInteraction` — the data-bound controller for the chat
 * panel. Wires runtime, sessions, and dock state to render a working
 * conversation surface.
 *
 * Extracted from `agent-interaction-screen.tsx` to keep the parent file
 * focused on the bare AgentInteractionScreen scaffold + ShellFrame chrome.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Result } from 'better-result'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@garden/core/chat'
import { useWorkspaceStore } from '@garden/core/workspace'
import { motion, AnimatePresence } from 'motion/react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
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
import { makeSessionTitle, type ChatRuntime } from '../chat-runtime-provider'
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
import { getToolCallId, getToolInput } from '@cloudflare/ai-chat/react'
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
import { IssueMentionCard } from '@/features/issues/components/issue-mention-card'

const EMPTY_CHAT_INTROS = [
  {
    direction: 'up',
    rest: 'with context.',
    slot: 'Ask',
    slotPosition: 'start',
    subtitle:
      "Attach a file or share the thread. I'll keep the answer grounded.",
  },
  {
    direction: 'down',
    rest: 'Turn rough notes into',
    slot: 'next steps.',
    slotPosition: 'end',
    subtitle: "Bring the messy version. We'll shape it into something usable.",
  },
  {
    direction: 'up',
    rest: 'from what you have.',
    slot: 'Draft',
    slotPosition: 'start',
    subtitle: "Paste the source material. I'll help make it clear.",
  },
] as const

function EmptyChatIntroSlot({
  direction,
  position,
  value,
}: {
  direction: (typeof EMPTY_CHAT_INTROS)[number]['direction']
  position: (typeof EMPTY_CHAT_INTROS)[number]['slotPosition']
  value: string
}) {
  const offset = direction === 'up' ? 18 : -18

  return (
    <span
      className={cn(
        'relative inline-grid h-[1.15em] overflow-hidden align-baseline',
        position === 'start' ? 'min-w-[4.5ch]' : 'min-w-[9.5ch]',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value}
          initial={{ opacity: 0, y: offset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -offset }}
          transition={{
            duration: 0.72,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="col-start-1 row-start-1 block text-left"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function EmptyChatIntroText({
  intro,
}: {
  intro: (typeof EMPTY_CHAT_INTROS)[number]
}) {
  return (
    <div className="w-full">
      <h2 className="mx-auto flex max-w-xl flex-wrap items-baseline justify-center gap-x-2 text-balance font-medium text-2xl leading-tight text-foreground sm:text-3xl lg:text-[2.35rem]">
        {intro.slotPosition === 'start' ? (
          <>
            <EmptyChatIntroSlot
              direction={intro.direction}
              position={intro.slotPosition}
              value={intro.slot}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={intro.rest}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
              >
                {intro.rest}
              </motion.span>
            </AnimatePresence>
          </>
        ) : (
          <>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={intro.rest}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
              >
                {intro.rest}
              </motion.span>
            </AnimatePresence>
            <EmptyChatIntroSlot
              direction={intro.direction}
              position={intro.slotPosition}
              value={intro.slot}
            />
          </>
        )}
      </h2>
      <div className="mx-auto mt-3 grid min-h-12 max-w-lg place-items-start">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={intro.subtitle}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
              delay: 0.12,
              duration: 0.46,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="col-start-1 row-start-1 text-balance text-muted-foreground text-sm leading-6 sm:text-base"
          >
            {intro.subtitle}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

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
  const [resolvedApprovalIds, setResolvedApprovalIds] = useState<string[]>([])
  const [isRetrying, setIsRetrying] = useState(false)
  const [documentPanelView, setDocumentPanelView] =
    useState<DocumentPanelView | null>(null)
  const [resolvedDocumentEditStatuses, setResolvedDocumentEditStatuses] =
    useState<DocumentEditStatusMap>({})
  const [optimisticPendingTurn, setOptimisticPendingTurn] = useState(false)
  const lastSentTextRef = useRef<string | null>(null)
  const pendingMessageCountRef = useRef<number | null>(null)
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
    setApprovalError(null)
    setDocumentPanelView(null)
    setIsRetrying(false)
    setOptimisticPendingTurn(false)
    setResolvedApprovalIds([])
    setResolvedDocumentEditStatuses({})
    setResolvingToolCallIds([])
    lastSentTextRef.current = null
    pendingMessageCountRef.current = null
  }, [sessionId])

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

    const uploadedDocsContext =
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

    // What the user has open in the side panel — could be a document,
    // a tracked edit, or a citation. All three carry the underlying
    // artifact, and the model wants to know about it in every case so
    // unqualified references like "this" or "the doc" land on the right
    // file. Mode is included so the prompt can mention edit/citation
    // context when relevant.
    const displayedDoc = documentPanelView?.artifact
      ? {
          handle: documentPanelView.artifact.id,
          filename: documentPanelView.artifact.filename,
          versionId: documentPanelView.artifact.versionId ?? null,
          versionNumber: documentPanelView.artifact.versionNumber ?? null,
          mode: documentPanelView.kind,
        }
      : null

    const displayedDocContext = displayedDoc
      ? `The user is currently viewing this document in the side panel${
          displayedDoc.mode === 'edit'
            ? ' (reviewing a tracked edit)'
            : displayedDoc.mode === 'citation'
              ? ' (looking at a cited passage)'
              : ''
        }. Prefer it as the implicit subject when the user says "this", "the doc", or otherwise refers to a document without naming one. Refer to it by filename only — never mention the handle, id, or version UUID:\n- handle: ${displayedDoc.handle}; filename: ${displayedDoc.filename}${
          displayedDoc.versionNumber ? ` (V${displayedDoc.versionNumber})` : ''
        }`
      : ''

    const documentContext = [uploadedDocsContext, displayedDocContext]
      .filter((part) => part.length > 0)
      .join('\n\n')

    const requestOptions = documentContext
      ? {
          body: {
            document_context: documentContext,
            displayed_doc: displayedDoc,
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
        ...(group.permissionRequestId
          ? { permissionRequestId: group.permissionRequestId }
          : { toolCallId: group.toolCallIds[0] ?? '' }),
      }).catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : 'Failed to resolve approval'
        setApprovalError(message)
        return null
      })

      if (result) {
        setResolvedApprovalIds((current) => [
          ...new Set([...current, ...group.approvalIds]),
        ])
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
  const visibleMessages = sessionIsFresh ? [] : messages
  const normalizedStatus = normalizeStatus(status)
  const showEmptyChatState = sessionIsFresh && normalizedStatus === 'idle'
  const [emptyIntroIndex, setEmptyIntroIndex] = useState(0)

  useEffect(() => {
    if (!showEmptyChatState) {
      setEmptyIntroIndex(0)
      return
    }

    const interval = window.setInterval(() => {
      setEmptyIntroIndex((current) => (current + 1) % EMPTY_CHAT_INTROS.length)
    }, 9000)

    return () => window.clearInterval(interval)
  }, [showEmptyChatState])

  const currentTitle = sessionIsFresh ? panelTitle : activeSession.title
  const emptyIntro = EMPTY_CHAT_INTROS[emptyIntroIndex] ?? EMPTY_CHAT_INTROS[0]
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
      primaryIssueId={activeSession.primary_issue_id ?? null}
      primaryIssue={activeSession.primaryIssue}
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
          {showEmptyChatState ? null : (
            <ChatTimeline
              debugMode={debugModeEnabled}
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
              resolvedApprovalIds={resolvedApprovalIds}
              resolvingToolCallIds={resolvingToolCallIds}
              onRetry={handleRetry}
              isRetrying={isRetrying}
              forcePendingActivity={optimisticPendingTurn}
            />
          )}
          <motion.div
            layout
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className={cn(
              showEmptyChatState
                ? 'flex min-h-0 flex-1 flex-col justify-start pt-[clamp(3.75rem,14vh,7rem)]'
                : 'shrink-0',
            )}
          >
            <AnimatePresence>
              {showEmptyChatState ? (
                <motion.div
                  key="garden-greeting"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="mb-7 px-4 text-center"
                >
                  <div className="mx-auto grid min-h-[6.75rem] w-full max-w-2xl place-items-center overflow-visible sm:min-h-[7.5rem]">
                    <EmptyChatIntroText intro={emptyIntro} />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <AnimatePresence>
              {showEmptyChatState ? (
                <motion.div
                  key="suggestions"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="shrink-0 px-4 pb-2"
                >
                  <div className="mx-auto max-w-2xl">
                    <Suggestions className="mx-auto justify-center">
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
                </motion.div>
              ) : null}
            </AnimatePresence>
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
          </motion.div>
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
  primaryIssueId = null,
  primaryIssue = null,
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
  primaryIssueId?: string | null
  primaryIssue?: AgentChatSession['primaryIssue']
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
                {primaryIssueId ? (
                  <IssueMentionCard
                    issueId={primaryIssueId}
                    issue={primaryIssue}
                  />
                ) : null}
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
