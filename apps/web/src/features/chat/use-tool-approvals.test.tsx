import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalGroup } from './components/chat-message-parts'
import { useToolApprovals } from './use-tool-approvals'
import type { ChatUiMessage } from './chat-runtime-provider'

const mocks = vi.hoisted(() => ({
  resolveToolApproval: vi.fn(),
  listRequests: vi.fn(),
}))

vi.mock(import('./components/chat-tool-activity'), async (original) => ({
  ...(await original()),
  resolveToolApproval: mocks.resolveToolApproval,
}))
vi.mock('@/lib/api/chat-threads', () => ({
  chatKeys: {
    agentProposalRequests: (id: string) => ['agent-proposals', id],
  },
  listThreadAgentProposalRequests: mocks.listRequests,
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
  addToolApprovalResponse = vi.fn(),
  messages: ChatUiMessage[] = [],
) {
  return renderHook(
    () =>
      useToolApprovals({
        sessionId: 'thread-1',
        messages,
        addToolApprovalResponse,
        continueAfterGardenApproval,
      }),
    { wrapper },
  )
}

describe('useToolApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRequests.mockResolvedValue({ requests: [] })
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

  it('resumes an Inbox-decided proposal without recording the decision again', async () => {
    const proposal: ChatUiMessage = {
      id: 'proposal',
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_agent',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: {
            permission_request_id: 'perm-1',
            pending_agent_id: 'agent-2',
          },
        },
      ],
    }
    mocks.listRequests.mockResolvedValue({
      requests: [
        { id: 'perm-1', status: 'denied', pending_agent_id: 'agent-2' },
      ],
    })
    const resume = vi.fn().mockResolvedValue({ ok: true, status: 'completed' })
    const seen = renderApprovals(resume, vi.fn(), [proposal])
    const input = {
      permissionRequestId: 'perm-1',
      pendingAgentId: 'agent-2',
      approved: false,
    }
    await waitFor(() =>
      expect(seen.result.current.recordedContinuations).toEqual([input]),
    )
    await act(async () => {
      await seen.result.current.resumeRecordedProposal(input)
    })
    expect(resume).toHaveBeenCalledExactlyOnceWith(input)
    expect(mocks.resolveToolApproval).not.toHaveBeenCalled()
    expect(seen.result.current.recordedContinuations).toEqual([])
    seen.unmount()
    const restored = renderApprovals(resume, vi.fn(), [
      proposal,
      { id: 'garden-proposal:perm-1', role: 'user', parts: [] },
    ])
    await waitFor(() =>
      expect(
        restored.result.current.resolvedAgentProposalRequestIds.has('perm-1'),
      ).toBe(true),
    )
    expect(restored.result.current.recordedContinuations).toEqual([])
  })

  it('keeps a partial connector decision visible and sends only decisions the server confirms', async () => {
    const send = vi.fn()
    const { result } = renderApprovals(vi.fn(), send)
    const group = {
      ...GROUP,
      permissionRequestId: undefined,
      toolCallIds: ['call-1', 'call-2'],
      approvalIds: ['approval-1', 'approval-2'],
    }
    mocks.resolveToolApproval.mockRejectedValueOnce(
      new Error('Review the connector requests in the Inbox.'),
    )
    await act(async () => {
      await result.current.handleResolveToolApproval(group, true)
    })
    expect(send).not.toHaveBeenCalled()
    expect(result.current.resolvedApprovalIds).toEqual([])
    expect(result.current.approvalError).toContain('Inbox')
    mocks.resolveToolApproval.mockResolvedValueOnce({ toolCallIds: ['call-2'] })
    await act(async () => {
      await result.current.handleResolveToolApproval(group, true)
    })
    expect(send).toHaveBeenCalledExactlyOnceWith({
      id: 'approval-2',
      approved: true,
    })
    expect(result.current.resolvedApprovalIds).toEqual(['approval-2'])
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
