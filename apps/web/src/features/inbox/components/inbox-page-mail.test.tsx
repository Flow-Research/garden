import { fireEvent, render, screen } from '@testing-library/react'
import type { InboxItem } from '@garden/core/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveMailInboxController } from '../mail-inbox-controller'
import type { GmailImportController } from '../gmail-import-controller'
import { InboxPage } from './inbox-page'
import type { MailConversationSummaryView } from './mail'

const replace = vi.hoisted(() => vi.fn())
const toggleRead = vi.hoisted(() => vi.fn())
const openComposer = vi.hoisted(() => vi.fn())
const archiveMail = vi.hoisted(() => vi.fn())

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
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: [notification] }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../mail-inbox-controller', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../mail-inbox-controller')>()
  return {
    ...actual,
    useMailInboxController: () => actual.unavailableMailInboxController,
  }
})

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
    searchParams: new URLSearchParams(window.location.search),
    replace,
  }),
}))

vi.mock('@/components/shell/workspace-dock', () => ({
  useWorkspaceDock: () => ({ openPanel: vi.fn() }),
}))

vi.mock('./inbox-control-plane', () => ({
  InboxControlPlane: () => null,
}))

function activeMailController(
  detail: ActiveMailInboxController['detail'] = { status: 'idle' },
): ActiveMailInboxController {
  return {
    status: 'active',
    canCompose: true,
    list: {
      status: 'ready',
      entries: [
        {
          conversation,
          sortTimestamp: '2026-08-10T11:00:00.000Z',
        },
      ],
    },
    detail,
    composer: null,
    folders: [],
    actions: {
      openComposer,
      closeComposer: vi.fn(),
      toggleStar: vi.fn(),
      toggleRead,
      archive: archiveMail,
      viewSource: vi.fn(),
      reply: vi.fn(),
      replyAll: vi.fn(),
      forward: vi.fn(),
      assignAgent: vi.fn(),
      unassignAgent: vi.fn(),
      messageProps: () => ({}),
    },
  }
}

function connectedGmailController(): GmailImportController {
  return {
    state: { status: 'connected' },
    accounts: [
      {
        connectionAddress: 'u:user-1/google_gmail/personalGmail',
        identityLabel: 'kixeyems0@gmail.com',
        iconUrl: null,
        importMode: 'read_only',
      },
    ],
    selectedConnectionAddress: 'u:user-1/google_gmail/personalGmail',
    gmailIconUrl: null,
    actions: {
      connect: vi.fn(),
      selectAccount: vi.fn(),
      startImport: vi.fn(),
      retryImport: vi.fn(),
      cancelImport: vi.fn(),
      resumeImport: vi.fn(),
    },
  }
}

describe('InboxPage mail composition', () => {
  beforeEach(() => {
    replace.mockReset()
    toggleRead.mockReset()
    openComposer.mockReset()
    archiveMail.mockReset()
    window.history.replaceState({}, '', '/')
  })

  it('keeps notifications working and exposes honest unavailable mail state', () => {
    render(<InboxPage />)

    expect(screen.getAllByText('Research finished')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Mail' }))
    expect(screen.getByText("Mail isn't available yet")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    expect(screen.getAllByText('Research finished')).not.toHaveLength(0)
  })

  it('interleaves controller mail and delegates selection and compose', () => {
    render(
      <InboxPage
        mailController={activeMailController()}
        gmailImportController={connectedGmailController()}
      />,
    )

    expect(screen.getByText('Term sheet follow-up')).toBeInTheDocument()
    expect(screen.getByText('Research finished')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Import emails' }),
    ).toBeInTheDocument()

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

  it('opens the first unified item when the URL has no explicit selection', () => {
    render(
      <InboxPage
        mailController={activeMailController({
          status: 'ready',
          conversation: {
            ...conversation,
            mailboxId: 'mailbox-1',
            canSend: false,
            agentAssignments: [],
            messages: [],
          },
        })}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Unread conversation: Term sheet follow-up',
      }),
    ).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('heading', { name: 'Term sheet follow-up' }),
    ).toBeInTheDocument()
  })

  it('archives an open mail conversation and closes its detail surface', () => {
    window.history.replaceState(
      {},
      '',
      '/?item=mail%3Aconversation-1&scope=mail',
    )
    render(
      <InboxPage
        mailController={activeMailController({
          status: 'ready',
          conversation: {
            ...conversation,
            mailboxId: 'mailbox-1',
            canSend: false,
            agentAssignments: [],
            messages: [],
          },
        })}
      />,
    )

    const archiveButtons = screen.getAllByRole('button', { name: 'Archive' })
    const detailArchive = archiveButtons.at(-1)
    expect(detailArchive).toBeDefined()
    if (!detailArchive) throw new Error('Expected detail Archive action')
    fireEvent.click(detailArchive)

    expect(archiveMail).toHaveBeenCalledWith('conversation-1')
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining('item='))
  })
})
