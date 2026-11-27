import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { InboxControlPlane } from './inbox-control-plane'

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  listConnections: mocks.listConnections,
  api: {
    getActiveRun: vi.fn(async () => ({ run: null, events: [] })),
    getIssue: vi.fn(async () => null),
    listIssueWorkProducts: vi.fn(async () => []),
  },
}))

const ITEM: InboxItem = {
  id: 'item-1',
  workspace_id: 'ws-1',
  recipient_type: 'member',
  recipient_id: 'user-1',
  actor_type: 'agent',
  actor_id: 'agent-1',
  type: 'connector_needed',
  severity: 'action_required',
  issue_id: null,
  title: 'Connect Gmail',
  body: 'Garden needs Gmail to continue.',
  issue_status: null,
  read: false,
  archived: false,
  created_at: '2026-10-20T10:00:00.000Z',
  details: { connector_id: 'gmail', connector_label: 'Gmail' },
}

describe('InboxControlPlane connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listConnections.mockResolvedValue({ integrations: [] })
  })

  it('re-enables Connect when the authorization popup is closed unfinished', async () => {
    const popup = { closed: false }
    vi.spyOn(window, 'open').mockReturnValue(popup as Window)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WorkspaceIdProvider wsId="ws-1">
          <InboxControlPlane item={ITEM} />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )

    const connect = screen.getByRole('button', { name: 'Connect Gmail' })
    fireEvent.click(connect)
    expect(connect).toBeDisabled()
    expect(screen.getByText('Waiting for authorization...')).toBeTruthy()

    popup.closed = true

    await waitFor(() => expect(connect).not.toBeDisabled(), { timeout: 4000 })
    expect(screen.queryByText('Waiting for authorization...')).toBeNull()
  })
})
