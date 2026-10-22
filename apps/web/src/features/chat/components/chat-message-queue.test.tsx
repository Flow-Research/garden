import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatMessageQueue, type QueuedChatMessage } from './chat-message-queue'

function queued(overrides: Partial<QueuedChatMessage> = {}): QueuedChatMessage {
  return {
    id: 'q1',
    text: 'Lets go away',
    files: [],
    selectedDocuments: [],
    ...overrides,
  }
}

function props(
  overrides: Partial<Parameters<typeof ChatMessageQueue>[0]> = {},
) {
  return {
    messages: [queued()],
    onEdit: vi.fn(),
    onSendNext: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  }
}

describe('ChatMessageQueue', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <ChatMessageQueue {...props({ messages: [] })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * The count and the "when does this send" explanation are said once over the
   * whole stack, not per row. This is the 2026-09-17 review's compaction: the
   * old layout repeated "Queue N · Reply after current reply" above every
   * message and made each row two lines tall.
   */
  it('states the queue depth once instead of labelling every row', () => {
    render(
      <ChatMessageQueue
        {...props({
          messages: [
            queued(),
            queued({ id: 'q2', text: 'Hello to the greatest willers' }),
          ],
        })}
      />,
    )

    expect(screen.getByText('2 queued')).toBeInTheDocument()
    expect(
      screen.getByText('Send in order after this reply'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Queue 1')).not.toBeInTheDocument()
    expect(screen.getByText('Lets go away')).toBeInTheDocument()
    expect(
      screen.getByText('Hello to the greatest willers'),
    ).toBeInTheDocument()
  })

  it('names the attachments when a queued send carries no prose', () => {
    render(
      <ChatMessageQueue
        {...props({
          messages: [
            queued({
              text: '',
              files: [
                new File(['x'], 'brief.pdf', { type: 'application/pdf' }),
              ],
            }),
          ],
        })}
      />,
    )
    expect(screen.getByText('1 attachment')).toBeInTheDocument()
  })

  it('hands the whole message to onEdit and only the id to onRemove', async () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const message = queued()
    render(
      <ChatMessageQueue
        {...props({ messages: [message], onEdit, onRemove })}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Edit queued message' }),
    )
    expect(onEdit).toHaveBeenCalledWith(message)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove queued message' }),
    )
    expect(onRemove).toHaveBeenCalledWith('q1')
  })

  /**
   * The up-arrow promotes a message to the front of the queue. The row that is
   * already next has nothing to promote, so it must not render the control —
   * otherwise the first row offers a button that provably does nothing.
   */
  it('offers send-next on every row except the one already at the front', async () => {
    const onSendNext = vi.fn()
    render(
      <ChatMessageQueue
        {...props({
          messages: [queued(), queued({ id: 'q2', text: 'second' })],
          onSendNext,
        })}
      />,
    )

    const promote = screen.getAllByRole('button', {
      name: 'Send this one next',
    })
    expect(promote).toHaveLength(1)

    await userEvent.click(promote[0]!)
    expect(onSendNext).toHaveBeenCalledWith('q2')
  })

  it('no longer offers a copy action', () => {
    render(<ChatMessageQueue {...props()} />)
    expect(
      screen.queryByRole('button', { name: /copy/i }),
    ).not.toBeInTheDocument()
  })
})
