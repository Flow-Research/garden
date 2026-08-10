import { fireEvent, render, screen } from '@testing-library/react'
import type { InboxItem } from '@garden/core/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveMailInboxController } from '../mail-inbox-controller'
import { InboxPage } from './inbox-page'
import type { MailConversationSummaryView } from './mail'

const replace = vi.hoisted(() => vi.fn())
const toggleRead = vi.hoisted(() => vi.fn())
const openComposer = vi.hoisted(() => vi.fn())

const notification: InboxItem = {
  id: 'notification-1',
  workspace_id: 'workspace-1',
  recipient_type: 'member',
  recipient_id: 'member-1',
  actor_type: 'agent',
  actor_id: 'agent-1',
  type: 'task_completed',
  severity: 'info',
  issue_id: null,
  title: 'Research finished',
  body: 'Investor research is ready.',
  issue_status: null,
  read: false,
  archived: false,
  created_at: '2026-08-10T10:00:00.000Z',
  details: null,
}

const conversation: MailConversationSummaryView = {
  id: 'conversation-1',
  subject: 'Term sheet follow-up',
  participants: [{ name: 'Ada Investor', address: 'ada@example.com' }],
  snippet: 'Sharing the revised terms.',
  dateLabel: '11:00 AM',
  messageCount: 2,
  unread: true,
  starred: false,
}

vi.mock('@garden/app-state/hooks', () => ({
  useWorkspaceId: () => 'workspace-1',
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [notification] }),
}))

vi.mock('@/lib/inbox/queries', () => ({
  inboxListOptions: () => ({}),
  deduplicateInboxItems: (items: InboxItem[]) => items,
}))

vi.mock('@/lib/inbox/mutations', () => ({
  useMarkInboxRead: () => ({ mutate: vi.fn() }),
  useArchiveInbox: () => ({ mutate: vi.fn() }),
  useMarkAllInboxRead: () => ({ mutate: vi.fn() }),
  useArchiveAllInbox: () => ({ mutate: vi.fn() }),
  useArchiveAllReadInbox: () => ({ mutate: vi.fn() }),
  useArchiveCompletedInbox: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/lib/workspace/hooks', () => ({
  useActorName: () => ({ getActorName: () => 'Garden Agent' }),
}))

vi.mock('../../navigation', () => ({
  useNavigation: () => ({
    searchParams: new URLSearchParams(),
    replace,
  }),
}))

vi.mock('@/components/shell/workspace-dock', () => ({
  useWorkspaceDock: () => ({ openPanel: vi.fn() }),
}))

function activeMailController(): ActiveMailInboxController {
  return {
    status: 'active',
    list: {
      status: 'ready',
      entries: [
        {
          conversation,
          sortTimestamp: '2026-08-10T11:00:00.000Z',
        },
      ],
    },
    detail: { status: 'idle' },
    composer: null,
    folders: [],
    actions: {
      openComposer,
      closeComposer: vi.fn(),
      toggleStar: vi.fn(),
      toggleImportant: vi.fn(),
      toggleRead,
      archive: vi.fn(),
      delete: vi.fn(),
      move: vi.fn(),
      viewSource: vi.fn(),
      reply: vi.fn(),
      replyAll: vi.fn(),
      forward: vi.fn(),
      messageProps: () => ({}),
    },
  }
}

describe('InboxPage mail composition', () => {
  beforeEach(() => {
    replace.mockReset()
    toggleRead.mockReset()
    openComposer.mockReset()
    window.history.replaceState({}, '', '/')
  })

  it('keeps notifications working and exposes honest unavailable mail state', () => {
    render(<InboxPage />)

    expect(screen.getByText('Research finished')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Mail' }))
    expect(screen.getByText("Mail isn't available yet")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    expect(screen.getByText('Research finished')).toBeInTheDocument()
  })

  it('interleaves controller mail and delegates selection and compose', () => {
    render(<InboxPage mailController={activeMailController()} />)

    expect(screen.getByText('Term sheet follow-up')).toBeInTheDocument()
    expect(screen.getByText('Research finished')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Unread conversation: Term sheet follow-up',
      }),
    )
    expect(toggleRead).toHaveBeenCalledWith('conversation-1')
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining('item=mail%3Aconversation-1'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Compose' }))
    expect(openComposer).toHaveBeenCalledOnce()
  })
})
