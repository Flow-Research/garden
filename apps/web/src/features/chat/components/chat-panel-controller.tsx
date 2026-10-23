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
import { useAuthStore } from '@garden/app-state/auth'
import { useChatStore } from '@garden/app-state/chat'
import { toast } from 'sonner'
import { useWorkspaceStore } from '@garden/app-state/workspace'
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
  isPendingFirstTurn,
  useAgentSessions,
  type AgentChatSession,
  NEW_SESSION_TITLE,
} from '../use-agent-chat-sessions'
import { makeSessionTitle, type ChatRuntime } from '../chat-runtime-provider'
import { chatThreadKeys } from '../queries'
import { useToolApprovals } from '../use-tool-approvals'
import { useStructuredInput } from '../use-structured-input'
import {
  DocumentSidePanel,
  withDocumentVersionUrl,
  type DocumentCitationAnnotation,
  type DocumentPanelView,
} from './chat-document-panel'
import {
  COMPOSER_WIDTH_CLASS_NAME,
  Composer,
  ComposerSuggestions,
  EMPTY_INTRO_EASE,
  createFileList,
  normalizeStatus,
  shouldPersistAsDocument,
  uploadAgentDocuments,
  type ComposerHandle,
  type ComposerThreadDocument,
} from './composer'
import {
  buildSelectedDocumentsContext,
  type SelectedThreadDocument,
} from './document-selection'
import { ChatMessageQueue, type QueuedChatMessage } from './chat-message-queue'
import {
  buildMessageHeaderAttachments,
  type ChatHeaderAttachment,
} from './chat-message-files'
import type { GardenArtifactData } from '@/features/artifacts/artifact-renderer'
import { ChatTimeline } from './chat-timeline'
import { X } from 'lucide-react'
import { HeaderAttachmentsMenu } from './chat-message-files'
import { IssueMentionCard } from '@/features/issues/components/issue-mention-card'

// `EMPTY_INTRO_EASE` is imported from `./composer` rather than redeclared
// here: the suggestion pills and this panel's lift animation have to move on
// the same curve, and two copies of a four-number tuple drift silently.

/**
 * Stand-in for "this session has nothing to show yet". Shared so the identity
 * is stable across renders (see `visibleMessages`).
 */
const NO_MESSAGES: ChatRuntime['messages'] = []

/**
 * What to show as a thread's preview the moment a turn is dispatched, before
 * there is any reply to summarise.
 *
 * Mirrors `buildSessionPreview` in `chat-runtime-provider.tsx`, which does the
 * same job for the assistant's message: prefer the prose, and fall back to
 * naming the attachments so a send that carries only files still produces a
 * non-empty preview. Non-empty matters beyond looks — an empty preview is half
 * of what marks a thread as never-used (`isPendingFirstTurn`).
 */
export function buildDispatchPreview(text: string, attachmentCount: number) {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  return attachmentCount > 0
    ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`
    : ''
}

// Quiet agent prompt — serif, in repose. The agent's voice greeting the
// person by first name when we have it, otherwise just a soft open.
function buildEmptyPrompt(firstName: string | null): string {
  return firstName
    ? `What can I help with, ${firstName}?`
    : 'What can I help with?'
}

// The four `EMPTY_STATE_TILES` and their `EmptyStateTile` renderer lived here
// until the 2026-09-08 composer overhaul. They are replaced by the seven-pill
// "Jump right in" row, which owns its own data and presentation in
// `./composer/composer-suggestions.tsx` (spec §10).

export function ConnectedChatPanelInteraction({
  activeSession,
  className,
  documentAttachments,
  onClose,
  panelDescription,
  panelTitle,
  runtime,
  updateSessionPreview,
}: {
  activeSession: AgentChatSession
  className?: string
  documentAttachments: ChatHeaderAttachment[]
  onClose?: () => void
  panelDescription?: string | null
  panelTitle: string
  runtime: ChatRuntime
  updateSessionPreview: ReturnType<
    typeof useAgentSessions
  >['updateSessionPreview']
}) {
  const sessionId = activeSession.id
  const queryClient = useQueryClient()
  const debugModeEnabled = useDevSettingsStore((s) => s.debugMode)
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null)
  const userFirstName = useAuthStore((s) => {
    const name = s.user?.name?.trim()
    if (!name) return null
    const first = name.split(/\s+/)[0]
    return first && first.length > 0 ? first : null
  })
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
  const [isRetrying, setIsRetrying] = useState(false)
  const [documentPanelView, setDocumentPanelView] =
    useState<DocumentPanelView | null>(null)
  const [optimisticPendingTurn, setOptimisticPendingTurn] = useState(false)
  const lastSentTextRef = useRef<string | null>(null)
  const pendingMessageCountRef = useRef<number | null>(null)
  /**
   * Messages written while a turn was already running (2026-09-16 queue
   * design). Held here rather than in the chat store because a queued send can
   * carry `File` handles, which `zustand/persist` cannot serialise — parking
   * them in persisted state would write a broken draft to storage and hand
   * back empty attachments on reload.
   *
   * The ref is the source of truth and `queuedMessages` mirrors it for render:
   * the drain loop below reads and writes the queue between awaits, where a
   * state value captured at call time would already be stale.
   */
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>([])
  const queuedMessagesRef = useRef<QueuedChatMessage[]>([])
  /**
   * True from the moment a turn is dispatched until the queue behind it has
   * drained. `status`/`isStreaming` alone cannot stand in for this: they still
   * read idle in the gap between one turn resolving and the next one starting,
   * which is exactly when a second send would jump the queue.
   */
  const isTurnInFlightRef = useRef(false)
  const updateQueue = useCallback(
    (update: (current: QueuedChatMessage[]) => QueuedChatMessage[]) => {
      queuedMessagesRef.current = update(queuedMessagesRef.current)
      setQueuedMessages(queuedMessagesRef.current)
    },
    [],
  )
  /** Restoring a queued message and focusing after a suggestion-pill prefill. */
  const composerRef = useRef<ComposerHandle>(null)
  /**
   * Which session the user dismissed the suggestion pills for. Keyed by
   * session id rather than a boolean because this component is NOT
   * `key`-remounted per session (the `<Composer>` is), so a boolean would
   * never reset and the pills would stay gone for every later chat. A new
   * empty chat has a new `sessionId`, so the pills return. No effect needed.
   */
  const [dismissedForSession, setDismissedForSession] = useState<string | null>(
    null,
  )
  /**
   * Per-render values `submitTurn` must read fresh rather than close over.
   *
   * Before: the drain loop below reuses the `submitTurn` closure from the
   * render `handleSend` was first called in, so every queued turn after the
   * first saw the message count, side-panel document and session title as they
   * were when the *first* message went out. Concretely: a document opened
   * mid-reply never reached the queued turns as context, and a session still
   * titled "New chat" in that old closure got renamed again off the second
   * queued message.
   *
   * After: the loop still runs one closure, but the values it must not stale
   * on are read from this ref at the top of each turn. `sessionId` rides along
   * so a turn can tell whether the panel it is about to describe still belongs
   * to the conversation it was sent from — see `submitTurn`.
   */
  const liveTurnContextRef = useRef({
    sessionId,
    messages: [] as typeof runtime.messages,
    documentPanelView,
    activeSession,
  })

  const {
    addToolApprovalResponse,
    addToolOutput,
    error,
    markTurnError,
    messages,
    sendMessage,
    status,
    stop,
    warmRuntime,
    isRecovering,
    isStreaming,
  } = runtime

  liveTurnContextRef.current = {
    sessionId,
    messages,
    documentPanelView,
    activeSession,
  }

  // Approval + structured-input surfaces own their own state (review #4); the
  // controller just threads the results into the timeline/composer.
  const {
    approvalError,
    resolvingToolCallIds,
    resolvedApprovalIds,
    resolvedAgentProposalRequestIds,
    handleResolveToolApproval,
  } = useToolApprovals({
    sessionId,
    messages,
    addToolApprovalResponse,
    continueAfterGardenApproval: runtime.continueAfterGardenApproval,
  })
  const { pendingStructuredInput, handleSubmitAnswers } = useStructuredInput({
    sessionId,
    messages,
    addToolOutput,
  })

  useLayoutEffect(() => {
    setDocumentPanelView(null)
    setIsRetrying(false)
    setOptimisticPendingTurn(false)
    lastSentTextRef.current = null
    pendingMessageCountRef.current = null
    // The queue belongs to the conversation it was typed into, so switching
    // sessions drops it rather than replaying it at whoever is next.
    queuedMessagesRef.current = []
    setQueuedMessages([])
    isTurnInFlightRef.current = false
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

  /**
   * Runs one turn end to end: uploads, context assembly, dispatch, and the
   * await on the reply. Resolves `true` when the turn completed, `false` when
   * it failed before or during dispatch — the drain loop below stops on
   * `false` so a broken run does not fire the rest of the queue at it.
   *
   * This is the body `handleSend` used to have; the queue wrapper now sits in
   * front of it.
   */
  const submitTurn = async ({
    text,
    files,
    selectedDocuments,
  }: {
    text: string
    files: File[]
    selectedDocuments: SelectedThreadDocument[]
  }): Promise<boolean> => {
    // A session switch mid-drain leaves the on-screen panel and message list
    // belonging to another conversation, so the live values are only usable
    // while this turn is still the active session's.
    const live = liveTurnContextRef.current
    const isActiveSession = live.sessionId === sessionId
    const liveMessages = isActiveSession ? live.messages : messages
    const liveDocumentPanelView = isActiveSession
      ? live.documentPanelView
      : null
    const liveSession = isActiveSession ? live.activeSession : activeSession
    const liveTitle = liveSession.title
    /**
     * Whether `/chats` would still hand this thread out as the next "New
     * Chat" (`isPendingFirstTurn`: placeholder title, empty preview). Read
     * before dispatch, because the write below is what stops it being true.
     */
    const wasWarm = isPendingFirstTurn(liveSession)

    lastSentTextRef.current = text
    pendingMessageCountRef.current = liveMessages.length
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
      liveTitle === NEW_SESSION_TITLE && text ? makeSessionTitle(text) : null
    runtime.setPendingTurn({
      title: nextTitle,
      preview: text,
    })

    /**
     * Dispatch-time session write.
     *
     * `status` stays client-side as before — it is transient UI noise the
     * server has no use for. What is new is that a thread's *first* turn also
     * persists its title and preview here rather than waiting for
     * `onFinish`.
     *
     * Before: those two fields were only committed when the client saw the
     * reply finish. Between dispatch and that moment the row still read
     * `title: "New Chat", lastMessage: ""` — which is exactly the
     * `isPendingFirstTurn` test `/chats` uses to pick the session to show. Two
     * things fell out of that window:
     *
     *   - If the turn never reached `onFinish` on this client — the tab
     *     closed mid-stream, the machine slept — the thread kept a real
     *     conversation in its runtime while its row still looked pristine
     *     forever. The next visit to `/chats` claimed it and rendered that
     *     conversation under the heading "New Chat". Observed 2026-09-18
     *     against thread a34f40b5.
     *   - `agent-interaction-screen.tsx` gates publishing the session to the
     *     router on the same `isPendingFirstTurn` flag, so the hop from
     *     `/chats` to `/chats/<id>` only happened once the reply landed. That
     *     is the "sending from /chats looked like a vanishing send" the route
     *     comment in `chats.index.tsx` describes.
     *
     * After: the row stops looking pristine the moment the turn is dispatched,
     * which closes both. `onFinish` still runs and still overwrites
     * `lastMessage` with the real reply — this only seeds it with what was
     * sent, the same fallback `onFinish` already used when a reply had no text
     * (`buildSessionPreview` → `pending.preview`).
     *
     * Gated on `wasWarm` so later turns keep exactly their old behaviour and
     * do not add a second round trip each.
     */
    updateSessionPreview({
      sessionId,
      status: 'submitted',
      unread: false,
      updatedAt: new Date().toISOString(),
      ...(wasWarm
        ? {
            ...(nextTitle ? { title: nextTitle } : {}),
            lastMessage: buildDispatchPreview(
              text,
              files.length + selectedDocuments.length,
            ),
            persist: true,
          }
        : {}),
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
      runtime.setPendingTurn(null)
      if (wasWarm) {
        // Nothing reached the agent, so the thread is still unused: undo the
        // first-turn title and preview seeded above, or it would read as a
        // conversation and /chats would stop offering it as the next chat.
        updateSessionPreview({
          sessionId,
          title: liveTitle,
          lastMessage: liveSession.lastMessage ?? '',
          persist: true,
        })
      }
      markTurnError(uploadResult.error)
      // The composer cleared when this was sent. Hand the message back so it
      // can be resent, unless the person has already started a new draft.
      const draft = useChatStore.getState().inputDrafts[sessionId] ?? ''
      const restorable = isActiveSession && draft.trim() === ''
      if (restorable) {
        composerRef.current?.restoreDraft({
          text,
          files,
          selectedDocumentIds: selectedDocuments.map(
            (document) => document.documentId,
          ),
        })
      }
      toast.error(
        restorable
          ? "Your files couldn't be uploaded. Your message is back in the composer."
          : "Your files couldn't be uploaded, so the message wasn't sent.",
      )
      return false
    }
    if (uploadResult.value.length > 0) {
      void queryClient.invalidateQueries({
        queryKey: chatThreadKeys.documents(sessionId),
      })
    }

    const selectedDocsContext = buildSelectedDocumentsContext(selectedDocuments)
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

    // What the user has open in the side panel — a document or citation.
    // Both carry the underlying artifact, and the model wants it so
    // unqualified references like "this" or "the doc" land on the right
    // file. Mode is included so the prompt can mention citation context.
    const displayedDoc = liveDocumentPanelView?.artifact
      ? {
          handle: liveDocumentPanelView.artifact.id,
          filename: liveDocumentPanelView.artifact.filename,
          versionId: liveDocumentPanelView.artifact.versionId ?? null,
          versionNumber: liveDocumentPanelView.artifact.versionNumber ?? null,
          mode: liveDocumentPanelView.kind,
        }
      : null

    const displayedDocContext = displayedDoc
      ? `The user is currently viewing this document in the side panel${
          displayedDoc.mode === 'citation'
            ? ' (looking at a cited passage)'
            : ''
        }. Prefer it as the implicit subject when the user says "this", "the doc", or otherwise refers to a document without naming one. Refer to it by filename only — never mention the handle, id, or version UUID:\n- handle: ${displayedDoc.handle}; filename: ${displayedDoc.filename}${
          displayedDoc.versionNumber ? ` (V${displayedDoc.versionNumber})` : ''
        }`
      : ''

    const documentContext = [
      selectedDocsContext,
      uploadedDocsContext,
      displayedDocContext,
    ]
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
      return false
    }
    return true
  }

  /**
   * What the composer calls on submit. Before the 2026-09-16 queue design a
   * mid-turn submit stopped the run; now it parks the payload and the drain
   * loop sends it the moment the running turn resolves, in the order it was
   * written.
   *
   * The drain is a loop here rather than an effect on `status` — `sendMessage`
   * resolves when its reply finishes, so "send the next one" is just the next
   * statement, with no render pass to synchronise against (and `useEffect` is
   * out per the repo's rules).
   */
  const handleSend = async (payload: {
    text: string
    files: File[]
    selectedDocuments: SelectedThreadDocument[]
  }) => {
    if (isTurnInFlightRef.current) {
      updateQueue((current) => [
        ...current,
        { id: crypto.randomUUID(), ...payload },
      ])
      return
    }

    isTurnInFlightRef.current = true
    let completed = await submitTurn(payload)
    while (completed) {
      const [next, ...rest] = queuedMessagesRef.current
      if (!next) break
      updateQueue(() => rest)
      completed = await submitTurn({
        text: next.text,
        files: next.files,
        selectedDocuments: next.selectedDocuments,
      })
    }
    isTurnInFlightRef.current = false
  }

  /**
   * `handleSend` is rebuilt every render (it closes over `submitTurn`, which
   * closes over this render's props), so anything that calls it later has to
   * reach the current one rather than capture one. Retry used to be a
   * `useCallback(…, [])` around it, which meant the retry button dispatched
   * through the very first render's closure for the life of the session.
   *
   * Reading through a ref also keeps `handleRetry` identity-stable, which is
   * what lets `ChatTimeline` below be memoized.
   */
  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

  /**
   * Pulls a queued message back into the composer. Removing it from the queue
   * first is what makes this an edit rather than a copy — leaving it in place
   * would send the original alongside whatever the person then rewrote.
   *
   * The composer owns the whole restore, text included: a queued message holds
   * what was committed, mentions already serialized, and only the composer can
   * turn those back into editable `@Label` text with live mention ranges.
   */
  const handleEditQueuedMessage = useCallback(
    (message: QueuedChatMessage) => {
      updateQueue((current) =>
        current.filter((queued) => queued.id !== message.id),
      )
      composerRef.current?.restoreDraft({
        text: message.text,
        files: message.files,
        selectedDocumentIds: message.selectedDocuments.map(
          (document) => document.documentId,
        ),
      })
    },
    [updateQueue],
  )

  /**
   * Moves a queued message to the front of the queue (the up-arrow on a row).
   *
   * "Send now" is not on offer while a turn is running: dispatching a second
   * turn into a live one is what the queue exists to prevent, and interrupting
   * the current reply is the stop button's job, not a side effect of
   * reordering. So the honest action is "go next", and the row that is already
   * next does not render the control at all.
   */
  const handleSendQueuedMessageNext = useCallback(
    (id: string) => {
      updateQueue((current) => {
        const promoted = current.find((queued) => queued.id === id)
        if (!promoted) return current
        return [promoted, ...current.filter((queued) => queued.id !== id)]
      })
    },
    [updateQueue],
  )

  const handleRemoveQueuedMessage = useCallback(
    (id: string) => {
      updateQueue((current) => current.filter((queued) => queued.id !== id))
    },
    [updateQueue],
  )

  const handleRetry = useCallback(async () => {
    const text = lastSentTextRef.current
    if (!text) return
    setIsRetrying(true)
    await handleSendRef.current({ text, files: [], selectedDocuments: [] })
    setIsRetrying(false)
  }, [])

  const sessionIsFresh =
    isUnusedIdleSession(activeSession) && messages.length === 0
  // Module constant, not a fresh `[]`: a new array identity every render would
  // defeat `ChatTimeline`'s memo on exactly the renders it matters for.
  const visibleMessages = sessionIsFresh ? NO_MESSAGES : messages
  const normalizedStatus = normalizeStatus(status)
  const showEmptyChatState = sessionIsFresh && normalizedStatus === 'idle'

  const currentTitle = sessionIsFresh ? panelTitle : activeSession.title
  const composerDocuments = useMemo<ComposerThreadDocument[]>(
    () =>
      documentAttachments.map((attachment) => ({
        documentId: attachment.id,
        filename: attachment.label,
        meta: attachment.meta,
        versionId: attachment.versionId ?? null,
        versionNumber: attachment.versionNumber ?? null,
      })),
    [documentAttachments],
  )
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
      onOpenAttachment={openDocumentAttachment}
      sidePanel={
        <DocumentSidePanel
          onClose={closeDocumentPanel}
          view={documentPanelView}
        />
      }
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
          <div className="flex min-h-0 flex-1 flex-col">
            {showEmptyChatState ? null : (
              <ChatTimeline
                debugMode={debugModeEnabled}
                sessionId={sessionId}
                messages={visibleMessages}
                error={error ?? null}
                status={status}
                isRecovering={isRecovering}
                isStreaming={isStreaming}
                onOpenDocument={openDocumentArtifact}
                onOpenCitation={openDocumentCitation}
                onResolveToolApproval={handleResolveToolApproval}
                resolvedApprovalIds={resolvedApprovalIds}
                resolvedPermissionRequestIds={resolvedAgentProposalRequestIds}
                resolvingToolCallIds={resolvingToolCallIds}
                onRetry={handleRetry}
                isRetrying={isRetrying}
                forcePendingActivity={optimisticPendingTurn}
              />
            )}
          </div>
          {/* Composer block — hero lives above as an absolutely-positioned
              child so its mount/unmount can't reflow the composer. The whole
              block lifts toward the visual center in empty state, then
              translates down to the panel bottom on first send. */}
          <motion.div
            className="relative shrink-0"
            initial={false}
            animate={{
              y: showEmptyChatState
                ? 'calc(-1 * clamp(7.5rem, 40vh, 22rem))'
                : 0,
              scale: showEmptyChatState ? 1.08 : 1,
              filter: showEmptyChatState
                ? 'drop-shadow(0 1px 1px rgba(91, 85, 77, 0.05)) drop-shadow(0 10px 22px rgba(91, 85, 77, 0.05)) drop-shadow(0 36px 64px rgba(91, 85, 77, 0.04))'
                : 'drop-shadow(0 0 0 rgba(91, 85, 77, 0))',
            }}
            transition={{ duration: 0.72, ease: EMPTY_INTRO_EASE }}
            style={{
              willChange: 'transform, filter',
              transformOrigin: 'center bottom',
            }}
          >
            <AnimatePresence initial={false}>
              {showEmptyChatState ? (
                <motion.div
                  key="empty-prompt"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{
                    opacity: 0,
                    transition: { duration: 0.22, ease: EMPTY_INTRO_EASE },
                  }}
                  transition={{
                    duration: 0.5,
                    delay: 0.06,
                    ease: EMPTY_INTRO_EASE,
                  }}
                  className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+3rem)] flex justify-center px-6"
                >
                  <p className="max-w-2xl text-balance body-large text-center font-prose text-text-default">
                    {buildEmptyPrompt(userFirstName)}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <Composer
              key={sessionId}
              ref={composerRef}
              agentId={activeSession.agentId}
              documents={composerDocuments}
              isStreaming={isStreaming || isRecovering}
              status={status}
              input={input}
              onInputChange={setInput}
              onSend={handleSend}
              onStop={stop}
              onWarmRuntime={warmRuntime}
              pendingQuestions={pendingStructuredInput?.questions}
              onSubmitAnswers={handleSubmitAnswers}
              queue={
                <ChatMessageQueue
                  messages={queuedMessages}
                  onEdit={handleEditQueuedMessage}
                  onSendNext={handleSendQueuedMessageNext}
                  onRemove={handleRemoveQueuedMessage}
                />
              }
            />
            <AnimatePresence initial={false}>
              {showEmptyChatState && dismissedForSession !== sessionId ? (
                <motion.div
                  key="empty-suggestions"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{
                    opacity: 0,
                    y: 4,
                    transition: { duration: 0.2, ease: EMPTY_INTRO_EASE },
                  }}
                  transition={{
                    duration: 0.5,
                    delay: 0.16,
                    ease: EMPTY_INTRO_EASE,
                  }}
                  className="pointer-events-none absolute inset-x-0 top-[calc(100%+0.75rem)] mx-auto flex justify-center px-4"
                  style={{ willChange: 'transform, opacity' }}
                >
                  <div
                    className={cn(
                      'pointer-events-auto w-full',
                      COMPOSER_WIDTH_CLASS_NAME,
                    )}
                  >
                    <ComposerSuggestions
                      onSelect={(starter) => {
                        // One call, not two: the composer's field is controlled
                        // by this draft, so writing it is what puts the text on
                        // screen. (The Tiptap composer needed a second,
                        // imperative push because its `defaultValue` only
                        // seeded the editor at creation.) Focus is imperative
                        // because the draft says nothing about the caret.
                        setInput(starter)
                        composerRef.current?.focus()
                      }}
                      onDismiss={() => setDismissedForSession(sessionId)}
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </div>
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
  panelDescription,
  panelTitle,
  primaryIssueId = null,
  primaryIssue = null,
  sessionId = null,
  sidePanel,
}: {
  attachments?: ChatHeaderAttachment[]
  children: React.ReactNode
  className?: string
  onClose?: () => void
  onOpenAttachment?: (attachment: ChatHeaderAttachment) => void
  panelDescription?: string | null
  panelTitle: string
  primaryIssueId?: string | null
  primaryIssue?: AgentChatSession['primaryIssue']
  sessionId?: string | null
  sidePanel?: React.ReactNode
}) {
  const debugMode = useDevSettingsStore((s) => s.debugMode)

  return (
    <section className={cn('flex h-full min-h-0 bg-background', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate font-prose text-sm font-semibold">
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
      {sidePanel}
    </section>
  )
}
