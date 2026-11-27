import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { AgentInteractionScreen } from './agent-interaction-screen'

const sessionsState = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))

vi.mock('../use-agent-chat-sessions', () => ({
  isPendingFirstTurn: () => false,
  useAgentSessions: () => sessionsState.value,
}))
vi.mock('../chat-runtime-provider', () => ({
  useChatRuntimeConnection: () => null,
}))
vi.mock('./chat-panel-controller', () => ({
  ConnectedChatPanelInteraction: () => <div>chat panel</div>,
}))

function sessions(query: Record<string, unknown>, extra = {}) {
  sessionsState.value = {
    claimWarmSession: vi.fn(async () => undefined),
    sessions: [],
    updateSessionPreview: vi.fn(),
    warmSession: null,
    ...extra,
    sessionsQuery: {
      status: 'pending',
      isPending: false,
      isError: false,
      isSuccess: false,
      isFetching: false,
      refetch: vi.fn(),
      ...query,
    },
  }
  return sessionsState.value
}

function renderScreen(sessionId: string | null = null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentInteractionScreen sessionId={sessionId} />
    </QueryClientProvider>,
  )
}

describe('AgentInteractionScreen without a session', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1' } as User })
    useWorkspaceStore.setState({ workspace: { id: 'ws-1' } as Workspace })
  })

  it('shows loading while the chats load', () => {
    sessions({ status: 'pending', isPending: true, isFetching: true })
    renderScreen('thread-1')
    expect(screen.getByText('Loading chat…')).toBeInTheDocument()
  })

  it('says the chats failed to load, with a retry', () => {
    const state = sessions({ status: 'error', isError: true })
    renderScreen('thread-1')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load your chats.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      (state.sessionsQuery as { refetch: () => void }).refetch,
    ).toHaveBeenCalled()
  })

  it('says when a chat cannot be found', () => {
    sessions({ status: 'success', isSuccess: true })
    renderScreen('missing-thread')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This chat could not be found.',
    )
  })

  it('says when a new chat could not be started, and tries again', async () => {
    const claimWarmSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    sessions({ status: 'success', isSuccess: true }, { claimWarmSession })
    renderScreen()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not start a new chat.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await vi.waitFor(() => expect(claimWarmSession).toHaveBeenCalledTimes(2))
  })
})
