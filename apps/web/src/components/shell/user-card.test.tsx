import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'next-themes'
import type { MemberRole, Workspace } from '@garden/core/types'
import { workspaceKeys, workspaceListOptions } from '@/lib/workspace/queries'
import { UserCard } from './user-card'

const api = vi.hoisted(() => ({ listWorkspaces: vi.fn() }))
vi.mock('@/lib/api', () => ({ api, listConnections: vi.fn() }))

const existing: Workspace = {
  id: 'workspace-existing',
  name: 'Existing workspace',
  slug: 'existing',
  description: null,
  context: null,
  settings: {},
  issue_prefix: 'EX',
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
}
const invited: Workspace = {
  ...existing,
  id: 'workspace-invited',
  name: 'Invited elsewhere',
  slug: 'invited',
}
const clients: QueryClient[] = []

/**
 * Connects the real account menu to its production workspace query. The menu
 * previously displayed the indefinitely cached snapshot without any refresh.
 */
function AccountMenu() {
  const query = useQuery(workspaceListOptions())
  const memberRole: MemberRole = 'member'
  return (
    <UserCard
      user={{ id: 'member-1', name: 'Member', email: 'member@example.test' }}
      role={memberRole}
      workspaces={query.data ?? []}
      currentWorkspaceId={existing.id}
      onAccount={vi.fn()}
      onInviteMembers={vi.fn()}
      onLogout={vi.fn()}
      onSwitchWorkspace={vi.fn()}
      onCreateWorkspace={vi.fn()}
      onRefreshWorkspaces={() => {
        void query.refetch()
      }}
    />
  )
}

afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.clearAllMocks()
})

describe('account workspace menu', () => {
  it('refreshes on expansion while retaining the warm list until the response arrives', async () => {
    const finishRefresh = vi.fn<(memberships: Workspace[]) => void>()
    api.listWorkspaces.mockReturnValue(
      new Promise<Workspace[]>((resolve) => {
        finishRefresh.mockImplementation(resolve)
      }),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    clients.push(queryClient)
    queryClient.setQueryData(workspaceKeys.list(), [existing])
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AccountMenu />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(api.listWorkspaces).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    const expand = await screen.findByRole('button', { name: 'Workspaces' })
    fireEvent.click(expand)

    expect(screen.getByRole('button', { name: existing.name })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: invited.name }),
    ).not.toBeInTheDocument()
    expect(api.listWorkspaces).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishRefresh([existing, invited])
    })

    expect(
      await screen.findByRole('button', { name: invited.name }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: existing.name })).toBeVisible()
    fireEvent.click(expand)
    await waitFor(() =>
      expect(expand).toHaveAttribute('aria-expanded', 'false'),
    )
    expect(api.listWorkspaces).toHaveBeenCalledTimes(1)
  })
})
