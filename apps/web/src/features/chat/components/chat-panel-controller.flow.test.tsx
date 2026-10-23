import {
  forwardRef,
  useImperativeHandle,
  type ComponentProps,
  type Ref,
} from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Result } from 'better-result'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@garden/app-state/chat'
import type { ChatRuntime } from '../chat-runtime-provider'
import {
  NEW_SESSION_TITLE,
  type AgentChatSession,
} from '../use-agent-chat-sessions'
import { ConnectedChatPanelInteraction } from './chat-panel-controller'
import type { ComposerHandle } from './composer'

const mocks = vi.hoisted(() => ({
  restoreDraft: vi.fn(),
  uploadAgentDocuments: vi.fn(),
  toastError: vi.fn(),
  sendPayload: {
    text: 'Summarise this',
    files: [] as File[],
  },
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}))
vi.mock('./composer', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>()
  type StubProps = {
    onSend: (payload: {
      text: string
      files: File[]
      selectedDocuments: []
    }) => Promise<void>
  }
  return {
    ...actual,
    uploadAgentDocuments: mocks.uploadAgentDocuments,
    ComposerSuggestions: () => null,
    Composer: forwardRef(function ComposerStub(
      { onSend }: StubProps,
      ref: Ref<ComposerHandle>,
    ) {
      useImperativeHandle(ref, () => ({
        restoreDraft: mocks.restoreDraft,
        focus: () => {},
      }))
      return (
        <button
          type="button"
          onClick={() =>
            void onSend({ ...mocks.sendPayload, selectedDocuments: [] })
          }
        >
          Send
        </button>
      )
    }),
  }
})
vi.mock('./chat-timeline', () => ({ ChatTimeline: () => null }))
vi.mock('@/features/settings/components/environment-debug-drawer', () => ({
  EnvironmentDebugDrawer: () => null,
}))
vi.mock('@/features/settings/components/use-debug-stream', () => ({
  usePrefetchDebugStream: () => {},
}))
vi.mock('@/features/issues/components/issue-mention-card', () => ({
  IssueMentionCard: () => null,
}))

function session(overrides: Partial<AgentChatSession> = {}): AgentChatSession {
  return {
    id: 'thread-1',
    runtime_key: 'thread-1',
    runtime_kind: 'chat',
    primary_issue_id: null,
    primaryIssue: null,
    title: 'Planning',
    lastMessage: 'earlier',
    status: 'idle',
    unread: false,
    archivedAt: null,
    agentId: 'agent-1',
    ...overrides,
  } as AgentChatSession
}

function runtime(overrides: Partial<ChatRuntime> = {}): ChatRuntime {
  return {
    addToolApprovalResponse: vi.fn(),
    addToolOutput: vi.fn(),
    error: undefined,
    isRecovering: false,
    isServerStreaming: false,
    isStreaming: false,
    continueAfterGardenApproval: vi.fn(),
    markTurnError: vi.fn(),
    messages: [],
    sendMessage: vi.fn(async () => undefined),
    setPendingTurn: vi.fn(),
    status: 'ready',
    stop: vi.fn(),
    warmRuntime: vi.fn(),
    ...overrides,
  } as ChatRuntime
}

function renderController(
  chatRuntime: ChatRuntime,
  {
    activeSession = session(),
    updateSessionPreview = vi.fn(),
  }: {
    activeSession?: AgentChatSession
    updateSessionPreview?: ComponentProps<
      typeof ConnectedChatPanelInteraction
    >['updateSessionPreview']
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectedChatPanelInteraction
        activeSession={activeSession}
        documentAttachments={[]}
        panelTitle="Chat"
        runtime={chatRuntime}
        updateSessionPreview={updateSessionPreview}
      />
    </QueryClientProvider>,
  )
}

describe('ConnectedChatPanelInteraction document upload failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendPayload = {
      text: 'Summarise this',
      files: [new File(['%PDF'], 'report.pdf', { type: 'application/pdf' })],
    }
    mocks.uploadAgentDocuments.mockResolvedValue(
      Result.err(new Error('upload failed')),
    )
  })

  it('puts the message and its files back in the composer and says so', async () => {
    const chatRuntime = runtime()
    renderController(chatRuntime)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.restoreDraft).toHaveBeenCalledTimes(1))
    expect(mocks.restoreDraft).toHaveBeenCalledWith({
      text: 'Summarise this',
      files: mocks.sendPayload.files,
      selectedDocumentIds: [],
    })
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining('back in the composer'),
    )
    expect(chatRuntime.sendMessage).not.toHaveBeenCalled()
    expect(chatRuntime.setPendingTurn).toHaveBeenLastCalledWith(null)
  })

  it('keeps a new draft typed meanwhile instead of overwriting it', async () => {
    mocks.uploadAgentDocuments.mockImplementation(async () => {
      useChatStore.getState().setInputDraft('thread-1', 'a different question')
      return Result.err(new Error('upload failed'))
    })
    renderController(runtime())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringContaining("message wasn't sent"),
      ),
    )
    expect(mocks.restoreDraft).not.toHaveBeenCalled()
    useChatStore.getState().clearInputDraft('thread-1')
  })

  it('reverts the first-turn title and preview of a fresh thread', async () => {
    const updateSessionPreview = vi.fn()
    renderController(runtime(), {
      activeSession: session({ title: NEW_SESSION_TITLE, lastMessage: '' }),
      updateSessionPreview,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(updateSessionPreview).toHaveBeenLastCalledWith({
      sessionId: 'thread-1',
      title: NEW_SESSION_TITLE,
      lastMessage: '',
      persist: true,
    })
  })
})
