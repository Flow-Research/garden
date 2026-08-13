import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentChatSession } from '@garden/core/types'
import {
  AgentId,
  ConversationId,
  DraftId,
  MailboxId,
  UtcTimestamp,
} from '@garden/core/mail'
import type { MailAgentComposerDraft } from '@/lib/server/mail-api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MailAgentRuntime, mailboxAgentMessages } from './mail-agent-runtime'

const bindMailAgentContext = vi.hoisted(() => vi.fn())
const invalidateQueries = vi.hoisted(() => vi.fn())
const markTurnError = vi.hoisted(() => vi.fn())
const sendMessage = vi.hoisted(() => vi.fn())
const setPendingTurn = vi.hoisted(() => vi.fn())
const runtimeOptions = vi.hoisted(() => vi.fn())
const saveAgentMailDraft = vi.hoisted(() => vi.fn())
const resolveMailAgentAction = vi.hoisted(() => vi.fn())
const sidebarProps = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries }),
}))

vi.mock('@/features/chat/chat-runtime-provider', () => ({
  useChatRuntimeConnection: (options: unknown) => {
    runtimeOptions(options)
    return {
      markTurnError,
      messages: [],
      sendMessage,
      setPendingTurn,
      status: 'ready',
      stop: vi.fn(),
    }
  },
}))

vi.mock('@/features/chat/use-agent-chat-sessions', () => ({
  useAgentSessions: () => ({ updateSessionPreview: vi.fn() }),
}))

vi.mock('../../mail.queries', () => ({
  bindMailAgentContext,
  mailAgentSessionOptions: vi.fn(),
  saveAgentMailDraft,
  resolveMailAgentAction,
  mailKeys: {
    all: (workspaceId: string) => ['garden-mail', workspaceId],
    conversation: (workspaceId: string, conversationId: string) => [
      'garden-mail',
      workspaceId,
      'conversation',
      conversationId,
    ],
  },
}))

vi.mock('./mail-agent-sidebar', () => ({
  MailAgentSidebar: (props: {
    onSend: (text: string) => void
    onResolveApproval: (executionId: string, approved: boolean) => unknown
  }) => {
    sidebarProps(props)
    return (
      <button
        type="button"
        onClick={() => props.onSend('Summarize this email')}
      >
        Send agent turn
      </button>
    )
  },
}))

const session: AgentChatSession = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  ownerUserId: '00000000-0000-4000-8000-000000000003',
  title: 'Inbox agent',
  agentId: '00000000-0000-4000-8000-000000000004',
  hostName: 'mail-agent-host',
  primary_issue_id: null,
  runtime_kind: 'chat',
  runtime_key: '00000000-0000-4000-8000-000000000005',
  primaryIssue: null,
  createdAt: '2026-08-12T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
  lastMessage: '',
  archivedAt: '1970-01-01T00:00:00.000Z',
  status: 'idle',
  unread: false,
}

describe('MailAgentRuntime', () => {
  beforeEach(() => {
    bindMailAgentContext.mockReset()
    invalidateQueries.mockReset()
    markTurnError.mockReset()
    sendMessage.mockReset()
    setPendingTurn.mockReset()
    runtimeOptions.mockReset()
    saveAgentMailDraft.mockReset()
    resolveMailAgentAction.mockReset()
    sidebarProps.mockReset()
  })

  it('binds an authorized context token immediately before each turn', async () => {
    bindMailAgentContext.mockResolvedValue({ token: 'server-token' })
    sendMessage.mockResolvedValue(undefined)
    invalidateQueries.mockResolvedValue(undefined)

    render(
      <MailAgentRuntime
        workspaceId={session.workspaceId}
        conversationId="00000000-0000-4000-8000-000000000006"
        session={session}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send agent turn' }))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(bindMailAgentContext).toHaveBeenCalledWith({
      data: {
        workspaceId: session.workspaceId,
        conversationId: '00000000-0000-4000-8000-000000000006',
        agentId: session.agentId,
      },
    })
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'Summarize this email' },
      { body: { mail_context_token: 'server-token' } },
    )
  })

  it('does not submit when server context authorization fails', async () => {
    const denial = new Error('Conversation is outside the mailbox scope')
    bindMailAgentContext.mockRejectedValue(denial)

    render(
      <MailAgentRuntime
        workspaceId={session.workspaceId}
        conversationId="00000000-0000-4000-8000-000000000006"
        session={session}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send agent turn' }))

    await waitFor(() => expect(markTurnError).toHaveBeenCalledWith(denial))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('approves by opaque execution id without browser-selected agent authority', async () => {
    resolveMailAgentAction.mockResolvedValue({ status: 'approved' })
    render(
      <MailAgentRuntime
        workspaceId={session.workspaceId}
        conversationId="00000000-0000-4000-8000-000000000006"
        session={session}
      />,
    )
    const props = sidebarProps.mock.lastCall?.[0] as {
      onResolveApproval: (
        executionId: string,
        approved: boolean,
      ) => Promise<string>
    }

    await expect(
      props.onResolveApproval(
        'exec_174e67d2-bcbc-420b-a1f5-289ee6681b8f',
        true,
      ),
    ).resolves.toBe('approved')
    expect(resolveMailAgentAction).toHaveBeenCalledWith({
      data: {
        workspaceId: session.workspaceId,
        executionId: 'exec_174e67d2-bcbc-420b-a1f5-289ee6681b8f',
        action: 'accept',
      },
    })
    expect(resolveMailAgentAction.mock.calls[0]?.[0].data).not.toHaveProperty(
      'agentId',
    )
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['garden-mail', session.workspaceId],
    })
  })

  it('persists and opens the exact agent draft without transport identifiers', async () => {
    const persistedDraft: MailAgentComposerDraft = {
      id: DraftId.make('00000000-0000-4000-8000-000000000007'),
      mailboxId: MailboxId.make('00000000-0000-4000-8000-000000000008'),
      conversationId: ConversationId.make(
        '00000000-0000-4000-8000-000000000006',
      ),
      author: { _tag: 'Agent', agentId: AgentId.make(session.agentId) },
      replyToMessageId: null,
      status: 'editing',
      revision: 0,
      subject: 'Re: Transfer confirmation',
      textBody: 'Thanks — I will review this.',
      htmlBody: null,
      recipients: [],
      attachments: [],
      updatedAt: UtcTimestamp.make('2026-08-12T10:01:00.000Z'),
    }
    saveAgentMailDraft.mockResolvedValue(persistedDraft)
    const onOpenDraft = vi.fn(() => ({ status: 'opened' as const }))
    render(
      <MailAgentRuntime
        workspaceId={session.workspaceId}
        conversationId="00000000-0000-4000-8000-000000000006"
        session={session}
        onOpenDraft={onOpenDraft}
      />,
    )

    const options = runtimeOptions.mock.lastCall?.[0] as {
      clientTools: Record<
        string,
        { execute?: (input: unknown) => unknown | Promise<unknown> }
      >
    }
    expect(Object.keys(options.clientTools)).toEqual(['compose_mail'])
    expect(JSON.stringify(options.clientTools)).not.toContain('addressId')
    expect(JSON.stringify(options.clientTools)).not.toContain('syncAccountId')

    let output: unknown
    await act(async () => {
      output = await options.clientTools.compose_mail?.execute?.({
        mode: 'reply',
        body: 'Thanks — I will review this.',
        draft_capability: '00000000-0000-4000-8000-000000000009',
      })
    })

    expect(saveAgentMailDraft).toHaveBeenCalledWith({
      data: {
        workspaceId: session.workspaceId,
        agentId: session.agentId,
        draftCapability: '00000000-0000-4000-8000-000000000009',
        mode: 'reply',
        body: 'Thanks — I will review this.',
      },
    })
    expect(onOpenDraft).toHaveBeenCalledWith(persistedDraft)
    expect(output).toEqual({
      status: 'saved_opened',
      message:
        'Draft saved and opened in the composer. The user can review, edit, or send it.',
    })
    expect(JSON.stringify(output)).not.toContain('00000000-0000-4000')
    expect(JSON.stringify(output)).not.toContain('AccountId')
  })

  it('keeps persistence bound to the server turn when selection closes', async () => {
    const onOpenDraft = vi.fn(() => ({ status: 'opened' as const }))
    const rendered = render(
      <MailAgentRuntime
        workspaceId={session.workspaceId}
        conversationId="00000000-0000-4000-8000-000000000006"
        session={session}
        onOpenDraft={onOpenDraft}
      />,
    )
    rendered.rerender(
      <MailAgentRuntime
        workspaceId={session.workspaceId}
        conversationId={null}
        session={session}
        onOpenDraft={onOpenDraft}
      />,
    )

    const options = runtimeOptions.mock.lastCall?.[0] as {
      clientTools: Record<
        string,
        { execute?: (input: unknown) => unknown | Promise<unknown> }
      >
    }
    await options.clientTools.compose_mail?.execute?.({
      mode: 'reply',
      body: 'Thanks.',
      draft_capability: '00000000-0000-4000-8000-000000000010',
    })

    expect(saveAgentMailDraft).toHaveBeenCalledWith({
      data: expect.objectContaining({
        draftCapability: '00000000-0000-4000-8000-000000000010',
      }),
    })
    expect(saveAgentMailDraft.mock.calls[0]?.[0].data).not.toHaveProperty(
      'conversationId',
    )
  })

  it('projects tool lifecycle data without rendering reasoning parts', () => {
    const projected = mailboxAgentMessages([
      {
        id: 'assistant-message',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'private chain of thought' },
          {
            type: 'tool-tool_executor_execute',
            toolCallId: 'tool-call-1',
            state: 'output-available',
            input: {
              code: 'await tools.google_gmail.user.gmail.gmail.users.messages.get({ id })',
            },
            output: { status: 'completed' },
          },
          { type: 'text', text: 'That message confirms the transfer.' },
        ],
      },
    ] as Parameters<typeof mailboxAgentMessages>[0])

    expect(projected).toEqual([
      {
        id: 'assistant-message',
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            toolName: 'tool_executor_execute',
            state: 'output-available',
            input: {
              code: 'await tools.google_gmail.user.gmail.gmail.users.messages.get({ id })',
            },
            output: { status: 'completed' },
          },
          { type: 'text', text: 'That message confirms the transfer.' },
        ],
      },
    ])
    expect(JSON.stringify(projected)).not.toContain('private chain of thought')
  })
})
