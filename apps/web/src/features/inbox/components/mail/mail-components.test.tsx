import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MailComposer } from './mail-composer'
import { MailConversationRow } from './mail-conversation-row'
import { MailHtmlFrame } from './mail-html-frame'
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
    fireEvent.click(screen.getByRole('button', { name: 'Approve & send' }))
    expect(onSendDraft).toHaveBeenCalledOnce()
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
        }}
        ccBccVisible={false}
        onChange={onChange}
        onToggleCcBcc={onToggleCcBcc}
        onSend={onSend}
        onDiscard={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: 'Looks good.' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Looks good.' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cc/Bcc' }))
    expect(onToggleCcBcc).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledOnce()
  })
})
