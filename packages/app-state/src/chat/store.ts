import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from '../platform/workspace-storage'
import { defaultStorage } from '../platform/storage'
import { createLogger } from '@garden/observability/console'

const logger = createLogger('chat.store')

export const CHAT_MIN_W = 360
export const CHAT_MIN_H = 480
export const CHAT_DEFAULT_W = 420
export const CHAT_DEFAULT_H = 600

/**
 * Kept as a public type because existing consumers (chat-message-list,
 * views/chat types) import it. Items themselves no longer live in the
 * store — they flow through the React Query cache keyed by task id.
 */
export interface ChatTimelineItem {
  seq: number
  type: 'tool_use' | 'tool_result' | 'thinking' | 'text' | 'error'
  tool?: string
  content?: string
  input?: Record<string, unknown>
  output?: string
}

export interface ChatState {
  isOpen: boolean
  selectedAgentId: string | null
  activeSessionId: string | null
  visibleChatSessionIds: string[]
  showHistory: boolean
  /** Drafts per session: sessionId → markdown text. */
  inputDrafts: Record<string, string>
  /**
   * Sessions whose first turn failed. Persistent because the only other
   * "this chat erred" signal we have today (`status: 'error'`) is a transient
   * cache-only flag — once React Query refetches the threads list, status
   * resets to 'idle' and the errored chat starts looking like a fresh warm
   * chat again. That would let `claimWarmSession` hand the broken thread
   * back as the next "New Chat", which is the bug we're fixing.
   *
   * We store ids as a record for O(1) lookup; presence is what matters.
   */
  erroredSessionIds: Record<string, true>
  /** Raw user-chosen size — no clamp applied. UI layer clamps at render time. */
  chatWidth: number
  chatHeight: number
  isExpanded: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  setSelectedAgentId: (id: string) => void
  setActiveSession: (id: string | null) => void
  setVisibleChatSessions: (ids: string[]) => void
  setShowHistory: (show: boolean) => void
  setInputDraft: (sessionId: string, draft: string) => void
  clearInputDraft: (sessionId: string) => void
  setSessionErrored: (sessionId: string, errored: boolean) => void
  setChatSize: (width: number, height: number) => void
  setExpanded: (expanded: boolean) => void
}

const chatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      selectedAgentId: null,
      activeSessionId: null,
      visibleChatSessionIds: [],
      showHistory: false,
      inputDrafts: {},
      erroredSessionIds: {},
      chatWidth: CHAT_DEFAULT_W,
      chatHeight: CHAT_DEFAULT_H,
      isExpanded: false,
      setOpen: (open) => {
        logger.debug('setOpen', { from: get().isOpen, to: open })
        set({ isOpen: open })
      },
      toggle: () => {
        const next = !get().isOpen
        logger.debug('toggle', { to: next })
        set({ isOpen: next })
      },
      setSelectedAgentId: (id) => {
        logger.info('setSelectedAgentId', {
          from: get().selectedAgentId,
          to: id,
        })
        set({ selectedAgentId: id })
      },
      /**
       * Tracks the active workspace-dock chat session for sidebar highlighting.
       *
       * Before this existed, workspace dock code called an action that was
       * only present in test mocks, so Vite emitted a production bundle that
       * crashed during dock startup. The dock layout remains the source of
       * truth; this transient store field only mirrors active tab state for
       * components outside the dock.
       */
      setActiveSession: (id) => {
        logger.debug('setActiveSession', {
          from: get().activeSessionId,
          to: id,
        })
        set({ activeSessionId: id })
      },
      /**
       * Mirrors currently visible workspace-dock chat sessions.
       *
       * This lets chat navigation surfaces know which sessions are mounted
       * without persisting layout-derived state. FlexLayout recomputes this on
       * model changes.
       */
      setVisibleChatSessions: (ids) => {
        set({ visibleChatSessionIds: [...new Set(ids)] })
      },
      setShowHistory: (show) => {
        logger.debug('setShowHistory', { to: show })
        set({ showHistory: show })
      },
      setInputDraft: (sessionId, draft) => {
        set({ inputDrafts: { ...get().inputDrafts, [sessionId]: draft } })
      },
      clearInputDraft: (sessionId) => {
        const current = get().inputDrafts
        if (!(sessionId in current)) return
        logger.info('clearInputDraft', { sessionId })
        const next = { ...current }
        delete next[sessionId]
        set({ inputDrafts: next })
      },
      setSessionErrored: (sessionId, errored) => {
        const current = get().erroredSessionIds
        const isMarked = sessionId in current
        if (errored === isMarked) return
        logger.info('setSessionErrored', { sessionId, errored })
        const next = { ...current }
        if (errored) {
          next[sessionId] = true
        } else {
          delete next[sessionId]
        }
        set({ erroredSessionIds: next })
      },
      setChatSize: (w, h) => {
        logger.debug('setChatSize', { w, h })
        // Dragging = user chose a manual size → exit expanded mode
        set({ chatWidth: w, chatHeight: h, isExpanded: false })
      },
      setExpanded: (expanded) => {
        logger.info('setExpanded', { to: expanded })
        set({ isExpanded: expanded })
      },
    }),
    {
      name: 'garden_chat_drafts',
      storage: createJSONStorage(() =>
        createWorkspaceAwareStorage(defaultStorage),
      ),
      // Persist composer drafts and the errored-session bookkeeping.
      // Everything else is transient UI state (open/closed, panel size,
      // selected agent). Drafts survive reload so a user typing into a chat
      // doesn't lose their message on refresh; errored ids survive so a
      // first-turn failure can't get re-served as a "warm" chat after the
      // React Query cache refetches and forgets the client-side
      // status='error' flag.
      partialize: (s) => ({
        inputDrafts: s.inputDrafts,
        erroredSessionIds: s.erroredSessionIds,
      }),
      // Custom merge: ALWAYS replace persisted slices with the freshly
      // loaded values (or empty when storage is cold for the new
      // workspace). Default merge is shallow `{...current, ...persisted}`,
      // which would leak the previous workspace's drafts/errored ids when
      // the new workspace has no entry on disk. Replacing eliminates the
      // cross-workspace bleed and also closes the rehydrate race window —
      // the swap is atomic from React's perspective (one setState).
      merge: (persisted, current) => {
        const slice = persisted as
          | {
              inputDrafts?: Record<string, string>
              erroredSessionIds?: Record<string, true>
            }
          | undefined
        return {
          ...current,
          inputDrafts: slice?.inputDrafts ?? {},
          erroredSessionIds: slice?.erroredSessionIds ?? {},
        }
      },
    },
  ),
)

// On workspace switch, re-read drafts from the new workspace's namespace
// and reset transient (non-persisted) per-workspace UI state. The persist
// layer's `merge` handles `inputDrafts` atomically once `rehydrate()`
// resolves, so we don't pre-clear it here — pre-clearing opens a race
// where a keystroke between the clear and the storage read gets clobbered.
registerForWorkspaceRehydration(() => {
  logger.info('workspace rehydration: reloading chat drafts for new workspace')
  chatStore.setState({
    selectedAgentId: null,
    activeSessionId: null,
    visibleChatSessionIds: [],
    showHistory: false,
  })
  void chatStore.persist.rehydrate()
})

export const useChatStore = chatStore
