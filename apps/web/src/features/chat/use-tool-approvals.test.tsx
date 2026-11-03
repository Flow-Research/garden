import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalGroup } from './components/chat-message-parts'
import { useToolApprovals } from './use-tool-approvals'

const mocks = vi.hoisted(() => ({
  resolveToolApproval: vi.fn(),
}))

vi.mock('./components/chat-tool-activity', () => ({
  resolveToolApproval: mocks.resolveToolApproval,
}))
vi.mock('@/lib/api/chat-threads', () => ({
  chatKeys: {
    agentProposalRequests: (id: string) => ['agent-proposals', id],
  },
  listThreadAgentProposalRequests: vi.fn(async () => ({ requests: [] })),
}))

const GROUP = {
  approvalIds: ['approval-1'],
  toolCallIds: ['call-1'],
  permissionRequestId: 'perm-1',
  pendingAgentId: 'agent-2',
} as ApprovalGroup

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderApprovals(
  continueAfterGardenApproval: Parameters<
    typeof useToolApprovals
  >[0]['continueAfterGardenApproval'],
) {
  return renderHook(
    () =>
      useToolApprovals({
        sessionId: 'thread-1',
        messages: [],
        addToolApprovalResponse: vi.fn(),
        continueAfterGardenApproval,
      }),
    { wrapper },
  )
}

describe('useToolApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveToolApproval.mockResolvedValue({ toolCallIds: ['call-1'] })
  })

  it('surfaces a failed agent resume and lets it be retried', async () => {
    const continueAfterGardenApproval = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection closed'))
      .mockResolvedValueOnce({ ok: true, status: 'completed' })
    const { result } = renderApprovals(continueAfterGardenApproval)

    await act(async () => {
      await result.current.handleResolveToolApproval(GROUP, true)
    })

    expect(result.current.approvalError).toContain('Connection closed')
    expect(result.current.resolvingToolCallIds).toEqual([])
    expect(result.current.canRetryApprovalContinuation).toBe(true)

    act(() => result.current.retryApprovalContinuation())

    await waitFor(() =>
      expect(result.current.canRetryApprovalContinuation).toBe(false),
    )
    expect(result.current.approvalError).toBeNull()
    expect(continueAfterGardenApproval).toHaveBeenCalledTimes(2)
    expect(continueAfterGardenApproval).toHaveBeenLastCalledWith({
      approved: true,
      permissionRequestId: 'perm-1',
      pendingAgentId: 'agent-2',
    })
    // The approval itself was recorded once; only the resume is retried.
    expect(mocks.resolveToolApproval).toHaveBeenCalledTimes(1)
  })

  it('sends one response when approve is clicked twice in a row', async () => {
    const continueAfterGardenApproval = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 'completed' })
    const { result } = renderApprovals(continueAfterGardenApproval)

    await act(async () => {
      await Promise.all([
        result.current.handleResolveToolApproval(GROUP, true),
        result.current.handleResolveToolApproval(GROUP, true),
      ])
    })

    expect(mocks.resolveToolApproval).toHaveBeenCalledTimes(1)
    expect(continueAfterGardenApproval).toHaveBeenCalledTimes(1)
  })
})
