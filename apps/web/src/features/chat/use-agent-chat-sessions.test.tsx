import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import {
  useAgentSessions,
  type AgentChatSession,
} from './use-agent-chat-sessions'

const mocks = vi.hoisted(() => ({
  createChatThread: vi.fn(),
  listChatThreads: vi.fn(),
}))

vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  createChatThread: mocks.createChatThread,
  listChatThreads: mocks.listChatThreads,
}))

const USER: User = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@garden.test',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'Workspace',
  slug: 'workspace',
  description: null,
  context: null,
  settings: {},
  issue_prefix: 'WS',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function warmThread(id: string): AgentChatSession {
  return {
    id,
    runtime_key: id,
    runtime_kind: 'chat',
    primary_issue_id: null,
    primaryIssue: null,
    title: 'New Chat',
    lastMessage: '',
    status: 'idle',
    unread: false,
    archivedAt: null,
    agentId: null,
  } as unknown as AgentChatSession
}

describe('useAgentSessions.claimWarmSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: USER })
    useWorkspaceStore.setState({ workspace: WORKSPACE })
    mocks.listChatThreads.mockResolvedValue([])
    mocks.createChatThread.mockImplementation(
      () =>
        new Promise<AgentChatSession>((resolve) =>
          setTimeout(() => resolve(warmThread('thread-new')), 20),
        ),
    )
  })

  it('creates one thread when several callers claim at once', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    // The runtime provider and the chat screen each own an instance.
    const provider = renderHook(() => useAgentSessions(), { wrapper })
    const screen = renderHook(() => useAgentSessions(), { wrapper })
    await waitFor(() =>
      expect(provider.result.current.sessionsQuery.status).toBe('success'),
    )

    let claimed: AgentChatSession[] = []
    await act(async () => {
      claimed = await Promise.all([
        provider.result.current.claimWarmSession(),
        screen.result.current.claimWarmSession(),
        screen.result.current.claimWarmSession(),
      ])
    })

    expect(mocks.createChatThread).toHaveBeenCalledTimes(1)
    expect(new Set(claimed.map((session) => session.id))).toEqual(
      new Set(['thread-new']),
    )
  })
})
