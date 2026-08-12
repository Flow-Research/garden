import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MailComposer } from './mail-composer'
import {
  MailAgentSidebar,
  type MailAgentSidebarProps,
} from './mail-agent-sidebar'
import { MailConversationRow } from './mail-conversation-row'
import { MailConversationList } from './mail-conversation-list'
import { MailConversationDetail } from './mail-conversation-detail'
import { MailHtmlFrame } from './mail-html-frame'
import { MailListToolbar } from './mail-list-toolbar'
import { MailMessage } from './mail-message'
import { MailSplitView } from './mail-split-view'
import type { MailConversationView, MailMessageView } from './types'

const conversation: MailConversationView = {
  id: 'thread-1',
  subject: 'Quarterly update',
  participants: [{ name: 'Ada Lovelace', address: 'ada@example.com' }],
  snippet: 'Here is the update for this quarter.',
  dateLabel: '10:30 AM',
  messageCount: 2,
  unread: true,
  starred: false,
  draft: true,
  needsReply: true,
  mailboxId: 'mailbox-1',
  canSend: true,
  agentAssignments: [],
  messages: [],
}

describe('MailConversationRow', () => {
  it('opens from keyboard and keeps row actions independent', () => {
    const onOpen = vi.fn()
    const onToggleStar = vi.fn()

    render(
      <MailConversationRow
        conversation={{
          ...conversation,
          labels: [{ id: 'label-1', name: 'Investors', color: '#ff0000' }],
        }}
        selected={false}
        onOpen={onOpen}
        onToggleStar={onToggleStar}
        onToggleRead={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const row = screen.getByRole('button', {
      name: 'Unread conversation: Quarterly update',
    })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Star' }))
    expect(onToggleStar).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()

    expect(screen.queryByText('Needs reply')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Needs reply')).not.toBeInTheDocument()
    expect(screen.getByText('Investors')).not.toHaveStyle({
      borderLeft: '2px solid #ff0000',
    })
    expect(row).not.toHaveClass('min-h-24', 'border-b')
    expect(screen.getByText(conversation.snippet)).toHaveClass('line-clamp-1')
  })
})

describe('MailConversationList', () => {
  it('requests the next server page near the existing scroll boundary', () => {
    const onLoadMore = vi.fn()
    const { container } = render(
      <MailConversationList
        state="ready"
        conversations={[conversation]}
        renderConversation={(item) => <div key={item.id}>{item.subject}</div>}
        hasMore
        onLoadMore={onLoadMore}
      />,
    )
    const viewport = container.firstElementChild
    expect(viewport).toBeInstanceOf(HTMLElement)
    if (!(viewport instanceof HTMLElement)) return
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 350 },
    })
    fireEvent.scroll(viewport)
    expect(onLoadMore).toHaveBeenCalledOnce()
  })
})

describe('MailListToolbar', () => {
  it('keeps Cloudflare desktop search compact and collapses it to an action in narrow panes', () => {
    const onSearchExpandedChange = vi.fn()
    const props = {
      scope: 'mail' as const,
      search: '',
      unreadOnly: false,
      selectedCount: 0,
      searchExpanded: false,
      onScopeChange: vi.fn(),
      onSearchChange: vi.fn(),
      onUnreadOnlyChange: vi.fn(),
      onSearchExpandedChange,
      onClearSelection: vi.fn(),
    }
    const { rerender } = render(<MailListToolbar {...props} compact={false} />)

    const desktopSearch = screen.getByRole('textbox', { name: 'Search mail' })
    expect(desktopSearch.parentElement).toHaveClass('max-w-lg')

    rerender(<MailListToolbar {...props} compact />)
    expect(
      screen.queryByRole('textbox', { name: 'Search mail' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search mail' }))
    expect(onSearchExpandedChange).toHaveBeenCalledWith(true)
  })
})

describe('MailSplitView', () => {
  it('collapses the conversation list into a reopen control', () => {
    const onExpandList = vi.fn()
    render(
      <MailSplitView
        compact={false}
        detailOpen
        listCollapsed
        onExpandList={onExpandList}
        list={<div>Conversation rows</div>}
        detail={<div>Selected conversation</div>}
      />,
    )

    expect(screen.queryByText('Conversation rows')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand conversation list' }),
    )
    expect(onExpandList).toHaveBeenCalledOnce()
    expect(screen.getByText('Selected conversation')).toBeInTheDocument()
  })
})

describe('MailConversationDetail', () => {
  it('pins the latest-message composer below the scroll surface', () => {
    const latestMessage: MailMessageView = {
      id: 'message-1',
      from: { name: 'Ada', address: 'ada@example.com' },
      to: [{ address: 'me@example.com' }],
      sentAtLabel: 'Now',
      html: '<p>Hello</p>',
      textPreview: 'Hello',
      status: 'sent',
      agentAuthored: false,
    }

    render(
      <MailConversationDetail
        conversation={{
          ...conversation,
          messageCount: 1,
          labels: [{ id: 'label-1', name: 'Investors', color: '#ff0000' }],
          messages: [latestMessage],
        }}
        toolbar={<div>Thread toolbar</div>}
        expandedMessageIds={new Set(['message-1'])}
        replyingToMessageId="message-1"
        inlineComposer={<div>Reply composer</div>}
        onToggleMessage={vi.fn()}
      />,
    )

    const composer = screen.getByText('Reply composer')
    expect(composer.parentElement).toHaveAttribute(
      'data-mail-reply-surface',
      'sticky',
    )
    expect(screen.getByText('Investors')).not.toHaveStyle({
      borderLeft: '2px solid #ff0000',
    })
  })
})

describe('MailHtmlFrame', () => {
  it('sanitizes active content and auto-sizes inside an opaque sandbox', async () => {
    render(
      <MailHtmlFrame
        body={'<p>Hello</p><script>alert("xss")</script>'}
        autoSize
      />,
    )

    const frame = screen.getByTitle('Email content')
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('Hello'))

    const document = frame.getAttribute('srcdoc') ?? ''
    expect(document).not.toContain('alert("xss")')
    expect(document).not.toContain('alert("xss")')
    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain("default-src 'none'")
    expect(document).toContain('__gardenMailFrameHeight')
    expect(document).toContain('overflow-x: hidden')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame).toHaveStyle({ height: '100px' })

    window.dispatchEvent(
      new MessageEvent('message', {
        source: (frame as HTMLIFrameElement).contentWindow,
        data: { __gardenMailFrameHeight: true, height: 412 },
      }),
    )
    await waitFor(() => expect(frame).toHaveStyle({ height: '412px' }))

    window.dispatchEvent(
      new MessageEvent('message', {
        source: (frame as HTMLIFrameElement).contentWindow,
        data: { __gardenMailFrameHeight: true, height: 10_000_000 },
      }),
    )
    await waitFor(() => expect(frame).toHaveStyle({ height: '4000px' }))
    expect(frame).toHaveAttribute('scrolling', 'yes')
  })

  it('blocks remote tracking images while preserving embedded image content', async () => {
    render(
      <MailHtmlFrame
        body={
          '<img src="https://tracker.example/open.gif"><img src="data:image/gif;base64,AAAA">'
        }
      />,
    )

    const frame = await screen.findByTitle('Email content')
    expect(frame.getAttribute('srcdoc')).not.toContain(
      'https://tracker.example/open.gif',
    )
    expect(frame.getAttribute('srcdoc')).toContain('data:image/gif;base64,AAAA')
    expect(frame.getAttribute('srcdoc')).toContain('img-src data: cid:;')
  })
})

describe('MailMessage', () => {
  it('keeps old messages collapsed and exposes explicit draft actions', () => {
    const onToggleExpanded = vi.fn()
    const onSendDraft = vi.fn()
    const draft: MailMessageView = {
      id: 'draft-1',
      from: { name: 'Garden Agent', address: 'agent@example.com' },
      to: [{ name: 'Ada', address: 'ada@example.com' }],
      sentAtLabel: 'Draft saved now',
      html: '<p>Draft response</p>',
      textPreview: 'Draft response',
      status: 'draft',
      draftStatus: 'awaiting_approval',
      agentAuthored: true,
    }

    const { rerender } = render(
      <MailMessage
        message={draft}
        expanded={false}
        onToggleExpanded={onToggleExpanded}
        onSendDraft={onSendDraft}
      />,
    )

    expect(screen.queryByTitle('Message from Garden Agent')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()

    rerender(
      <MailMessage
        message={draft}
        expanded
        onToggleExpanded={onToggleExpanded}
        onSendDraft={onSendDraft}
      />,
    )
    expect(screen.getByTitle('Message from Garden Agent')).toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveClass(
      'border-l-2',
      'border-l-warning',
      'bg-warning/[0.02]',
    )
    expect(screen.getByRole('article')).not.toHaveClass('rounded-lg', 'border')
    expect(screen.getByTitle('Message from Garden Agent')).not.toHaveClass(
      'h-72',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve & send' }))
    expect(onSendDraft).toHaveBeenCalledOnce()
  })
})

describe('MailAgentSidebar', () => {
  const baseProps: MailAgentSidebarProps = {
    messages: [],
    status: 'idle',
    input: '',
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
  }

  it('keeps the mail surface focused on the agent, without an MCP tab', () => {
    render(<MailAgentSidebar {...baseProps} />)

    expect(screen.queryByText('AI')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'MCP' }),
    ).not.toBeInTheDocument()
  })

  it('sends controlled input and source prompts without effect state', () => {
    const onSend = vi.fn()
    const onInputChange = vi.fn()

    render(
      <MailAgentSidebar
        {...baseProps}
        input="  summarize this thread  "
        onInputChange={onInputChange}
        onSend={onSend}
      />,
    )

    fireEvent.change(screen.getByLabelText('Chat message input'), {
      target: { value: 'draft a reply' },
    })
    expect(onInputChange).toHaveBeenCalledWith('draft a reply')

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('summarize this thread')

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Summarize this email',
      }),
    )
    expect(onSend).toHaveBeenCalledWith('Summarize this email')
  })

  it('shows live composer activity and stop control', () => {
    const onStop = vi.fn()

    const { rerender } = render(
      <MailAgentSidebar
        {...baseProps}
        status="idle"
        onStop={onStop}
        messages={[
          {
            id: 'agent-message',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'I prepared a reply.' },
              {
                type: 'tool',
                toolName: 'compose_mail',
                state: 'output-available',
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('Draft saved and opened')).toBeInTheDocument()

    rerender(
      <MailAgentSidebar
        {...baseProps}
        status="streaming"
        onStop={onStop}
        messages={[
          {
            id: 'agent-message',
            role: 'assistant',
            parts: [{ type: 'text', text: 'I prepared a reply.' }],
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('uses Garden brand tokens instead of the inverted dark primary token', () => {
    render(
      <MailAgentSidebar
        {...baseProps}
        messages={[
          {
            id: 'user-message',
            role: 'user',
            parts: [{ type: 'text', text: 'Summarize this email' }],
          },
          {
            id: 'agent-message',
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                toolName: 'tool_executor_execute',
                state: 'output-available',
                input: {
                  code: 'await tools.google_gmail.user.gmail.gmail.users.threads.get({ threadId })',
                },
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('Summarize this email')).toHaveClass(
      'bg-brand',
      'text-brand-foreground',
    )
    expect(
      screen.getByText('Conversation read').previousElementSibling,
    ).toHaveClass('text-brand')
  })

  it('shows provider actions without exposing Executor code or identifiers', () => {
    render(
      <MailAgentSidebar
        {...baseProps}
        messages={[
          {
            id: 'archive-action',
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                toolName: 'tool_executor_execute',
                state: 'running',
                input: {
                  code: `await tools.google_gmail.user.gmail.gmail.users.threads.modify({
                    id: 'provider-thread-id',
                    removeLabelIds: ['INBOX'],
                  })`,
                },
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('Archiving email')).toBeInTheDocument()
    expect(screen.queryByText(/provider-thread-id/)).not.toBeInTheDocument()
    expect(screen.queryByText(/threads\.modify/)).not.toBeInTheDocument()
  })

  it('distinguishes approval, failure, and unknown tool states', () => {
    render(
      <MailAgentSidebar
        {...baseProps}
        messages={[
          {
            id: 'tool-states',
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                toolName: 'tool_executor_execute',
                state: 'output-available',
                output: {
                  structuredContent: {
                    status: 'user_approval_required',
                    executionId: 'private-execution-id',
                  },
                },
              },
              {
                type: 'tool',
                toolName: 'compose_mail',
                state: 'output-error',
              },
              {
                type: 'tool',
                toolName: 'obsolete_internal_tool_123',
                state: 'running',
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('Approval needed')).toBeInTheDocument()
    expect(screen.getByText('Draft could not be saved')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByText('private-execution-id')).not.toBeInTheDocument()
    expect(
      screen.queryByText('obsolete_internal_tool_123'),
    ).not.toBeInTheDocument()
  })

  it('resolves a paused Executor action inline without exposing its handle', async () => {
    const onResolveApproval = vi.fn().mockResolvedValue('approved')
    const executionId = 'exec_174e67d2-bcbc-420b-a1f5-289ee6681b8f'
    render(
      <MailAgentSidebar
        {...baseProps}
        onResolveApproval={onResolveApproval}
        messages={[
          {
            id: 'approval',
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                toolName: 'tool_executor_execute',
                state: 'output-available',
                input: {
                  code: `await google_gmail.user.gmail.gmail.users.threads.modify({})`,
                },
                output: {
                  structuredContent: {
                    status: 'waiting_for_interaction',
                    executionId,
                  },
                },
              },
            ],
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onResolveApproval).toHaveBeenCalledWith(executionId, true)
    await waitFor(() =>
      expect(screen.getByText('Action approved')).toBeInTheDocument(),
    )
    expect(screen.queryByText(executionId)).not.toBeInTheDocument()
    expect(screen.queryByText(/threads\.modify/)).not.toBeInTheDocument()
  })

  it('shows a concise runtime failure without backend details', () => {
    render(
      <MailAgentSidebar
        {...baseProps}
        status="error"
        errorMessage="Agent could not finish. Try again."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Agent could not finish. Try again.',
    )
  })
})

describe('MailComposer', () => {
  it('reports controlled field changes and actions', () => {
    const onChange = vi.fn()
    const onSend = vi.fn()
    const onToggleCcBcc = vi.fn()

    render(
      <MailComposer
        variant="inline"
        values={{
          to: 'ada@example.com',
          cc: '',
          bcc: '',
          from: 'investor@example.com',
          subject: 'Re: Quarterly update',
          body: '',
          htmlBody: '',
        }}
        ccBccVisible={false}
        onChange={onChange}
        onToggleCcBcc={onToggleCcBcc}
        onSend={onSend}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Message body')).toHaveAttribute(
      'contenteditable',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cc/Bcc' }))
    expect(onToggleCcBcc).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('renders uploaded attachment metadata and removes by opaque id', () => {
    const onRemoveAttachment = vi.fn()
    render(
      <MailComposer
        variant="inline"
        values={{
          to: 'ada@example.com',
          cc: '',
          bcc: '',
          from: 'investor@example.com',
          subject: 'Documents',
          body: '',
          htmlBody: '',
        }}
        attachments={[
          {
            id: 'attachment-id',
            filename: 'investor.pdf',
            contentType: 'application/pdf',
            sizeLabel: '3.0 KB',
          },
        ]}
        ccBccVisible={false}
        onChange={vi.fn()}
        onToggleCcBcc={vi.fn()}
        onSend={vi.fn()}
        onDiscard={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
      />,
    )

    expect(screen.getByText('investor.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove investor.pdf' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith('attachment-id')
  })

  it('matches Zero link behavior without a manual URL prompt', () => {
    const onFormat = vi.fn()
    const prompt = vi.spyOn(window, 'prompt')

    render(
      <MailComposer
        variant="inline"
        values={{
          to: 'ada@example.com',
          cc: '',
          bcc: '',
          from: 'investor@example.com',
          subject: 'Links',
          body: '',
          htmlBody: '',
        }}
        ccBccVisible={false}
        onChange={vi.fn()}
        onToggleCcBcc={vi.fn()}
        onFormat={onFormat}
        onSend={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Insert link' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(onFormat).toHaveBeenCalledWith('bold')
    expect(prompt).not.toHaveBeenCalled()
    prompt.mockRestore()
  })
})
