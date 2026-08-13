import { describe, expect, it } from 'vitest'
import { gardenMailExecutorToolkitSlug } from '@garden/core/mail'
import {
  browserApprovalOutcomeWaitMs,
  PAUSED_APPROVAL_TIMEOUT_MS,
} from '@executor-js/host-mcp/tool-server'
import {
  approvedGmailThreadState,
  approvedProviderMutationCompleted,
  resolveExecutorApprovalAgentId,
} from './mail-executor-approval'

describe('mail Executor approval authority', () => {
  it('binds the decision to the agent encoded by the paused session resource', async () => {
    const resource = {
      kind: 'toolkit',
      slug: await gardenMailExecutorToolkitSlug({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        agentId: 'agent-2',
      }),
    }

    await expect(
      resolveExecutorApprovalAgentId({
        resource,
        workspaceId: 'workspace-1',
        userId: 'user-1',
        candidateAgentIds: ['agent-1', 'agent-2'],
      }),
    ).resolves.toBe('agent-2')
  })

  it('rejects default, foreign-user, and inaccessible toolkit resources', async () => {
    const resource = {
      kind: 'toolkit',
      slug: await gardenMailExecutorToolkitSlug({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        agentId: 'agent-2',
      }),
    }

    await expect(
      resolveExecutorApprovalAgentId({
        resource: { kind: 'default' },
        workspaceId: 'workspace-1',
        userId: 'user-1',
        candidateAgentIds: ['agent-2'],
      }),
    ).resolves.toBeNull()
    await expect(
      resolveExecutorApprovalAgentId({
        resource,
        workspaceId: 'workspace-1',
        userId: 'another-user',
        candidateAgentIds: ['agent-2'],
      }),
    ).resolves.toBeNull()
    await expect(
      resolveExecutorApprovalAgentId({
        resource,
        workspaceId: 'workspace-1',
        userId: 'user-1',
        candidateAgentIds: ['agent-1'],
      }),
    ).resolves.toBeNull()
  })
})

describe('approved Gmail thread reconciliation', () => {
  const current = {
    lastReadMessageId: null,
    readAt: null,
    archivedAt: null,
    mutedAt: '2026-08-12T12:00:00.000Z',
    pinned: false,
  }

  it('combines read, archive, and star labels while preserving mute', () => {
    expect(
      approvedGmailThreadState({
        mutation: {
          threadId: 'thread-1',
          addLabelIds: ['STARRED'],
          removeLabelIds: ['UNREAD', 'INBOX'],
        },
        current,
        latestMessageId: 'message-2',
        now: '2026-08-13T10:00:00.000Z',
      }),
    ).toEqual({
      lastReadMessageId: 'message-2',
      readAt: '2026-08-13T10:00:00.000Z',
      archivedAt: '2026-08-13T10:00:00.000Z',
      mutedAt: '2026-08-12T12:00:00.000Z',
      pinned: true,
    })
  })

  it('projects unread, inbox, and unstar without touching unrelated state', () => {
    expect(
      approvedGmailThreadState({
        mutation: {
          threadId: 'thread-1',
          addLabelIds: ['UNREAD', 'INBOX'],
          removeLabelIds: ['STARRED'],
        },
        current: {
          ...current,
          lastReadMessageId: 'message-1',
          readAt: '2026-08-12T11:00:00.000Z',
          archivedAt: '2026-08-12T10:00:00.000Z',
          pinned: true,
        },
        latestMessageId: 'message-2',
        now: '2026-08-13T10:00:00.000Z',
      }),
    ).toEqual({
      lastReadMessageId: null,
      readAt: null,
      archivedAt: null,
      mutedAt: '2026-08-12T12:00:00.000Z',
      pinned: false,
    })
  })

  it('reconciles only a completed successful provider outcome', () => {
    expect(
      approvedProviderMutationCompleted({
        status: 'ok',
        executionStatus: 'completed',
        structured: { executionOutcome: 'completed' },
      }),
    ).toBe(true)
    expect(
      approvedProviderMutationCompleted({
        status: 'ok',
        executionStatus: 'paused',
        structured: { executionOutcome: 'paused' },
      }),
    ).toBe(true)
    expect(
      approvedProviderMutationCompleted({
        status: 'ok',
        executionStatus: 'completed',
        isError: true,
        structured: { executionOutcome: 'completed' },
      }),
    ).toBe(false)
    expect(
      approvedProviderMutationCompleted({
        status: 'not_found',
      }),
    ).toBe(false)
  })
})

describe('Executor approval outcome lease', () => {
  it('uses the existing execution deadline without inventing another timeout', () => {
    expect(
      browserApprovalOutcomeWaitMs(
        { expiresAt: '2026-08-13T10:04:00.000Z', ttlMs: 240_000 },
        Date.parse('2026-08-13T10:01:00.000Z'),
      ),
    ).toBe(180_000)
    expect(
      browserApprovalOutcomeWaitMs(
        { expiresAt: '2026-08-13T10:00:00.000Z', ttlMs: 240_000 },
        Date.parse('2026-08-13T10:01:00.000Z'),
      ),
    ).toBe(0)
    expect(browserApprovalOutcomeWaitMs(undefined, 0)).toBe(
      PAUSED_APPROVAL_TIMEOUT_MS,
    )
  })
})
