import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MailComposer } from './mail-composer'
import {
  MailAgentSidebar,
  type MailAgentSidebarProps,
} from './mail-agent-sidebar'
import { MailConversationRow } from './mail-conversation-row'
import { MailConversationList } from './mail-conversation-list'
import { MailHtmlFrame } from './mail-html-frame'
import { MailListToolbar } from './mail-list-toolbar'
import { MailMessage } from './mail-message'
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
        conversation={conversation}
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
    expect(screen.getByLabelText('Needs reply')).toBeInTheDocument()
  })
})

describe('MailConversationList', () => {
  it('requests the next server page near the existing scroll boundary', () => {
    const onLoadMore = vi.fn()
    const { container } = render(
      <MailConversationList
        state="ready"
        conversations={[conversation]}
        renderConversation={(item) => <div>{item.subject}</div>}
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

describe('MailHtmlFrame', () => {
  it('sanitizes active content and uses an opaque sandbox with CSP', async () => {
    render(<MailHtmlFrame body={'<p>Hello</p><script>alert("xss")</script>'} />)

    const frame = screen.getByTitle('Email content')
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('Hello'))

    const document = frame.getAttribute('srcdoc') ?? ''
    expect(document).not.toContain('<script')
    expect(document).not.toContain('alert("xss")')
    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain("default-src 'none'")
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
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
    fireEvent.click(screen.getByRole('button', { name: 'Approve & send' }))
    expect(onSendDraft).toHaveBeenCalledOnce()
  })
})

describe('MailAgentSidebar', () => {
  const baseProps: MailAgentSidebarProps = {
    activeTab: 'agent',
    onTabChange: vi.fn(),
    messages: [],
    status: 'idle',
    input: '',
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
  }

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
        name: 'Show me the latest inbox emails',
      }),
    )
    expect(onSend).toHaveBeenCalledWith('Show me the latest inbox emails')
  })

  it('shows live tool activity, draft handoff, and stop control', () => {
    const onEditDraft = vi.fn()
    const onStop = vi.fn()

    const { rerender } = render(
      <MailAgentSidebar
        {...baseProps}
        status="idle"
        onStop={onStop}
        onEditDraft={onEditDraft}
        messages={[
          {
            id: 'agent-message',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'I prepared a reply.' },
              {
                type: 'tool',
                toolName: 'draft_reply',
                state: 'output-available',
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('Drafting reply')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit & send in composer' }),
    )
    expect(onEditDraft).toHaveBeenCalledWith('agent-message')

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
})
