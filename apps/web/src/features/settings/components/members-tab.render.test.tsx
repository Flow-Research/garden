import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberWithUser, User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { teamKeys } from '@/features/teams/queries'
import { workspaceKeys } from '@/lib/workspace/queries'
import { MembersTab } from './members-tab'

// Each member row renders exactly one role Badge, so Badge renders count
// row renders.
const badgeRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@garden/ui/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => {
    badgeRenders.count++
    return <span>{children}</span>
  },
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api: {
    listMembers: vi.fn(),
    listWorkspaceInvitations: vi.fn(async () => []),
  },
}))

const MEMBERS = Array.from({ length: 20 }, (_, index) => ({
  id: `member-${index}`,
  workspace_id: 'ws-1',
  user_id: `user-${index}`,
  role: index === 0 ? 'owner' : 'member',
  created_at: '2026-01-01T00:00:00Z',
  name: `Person ${index}`,
  email: `person${index}@example.test`,
  avatar_url: null,
  github_user_id: null,
  github_login: null,
})) as MemberWithUser[]

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), MEMBERS)
  queryClient.setQueryData(workspaceKeys.invitations('ws-1'), [])
  queryClient.setQueryData(teamKeys.list('ws-1'), {
    teams: [],
    total: 0,
    unique_member_count: 0,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <MembersTab />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('MembersTab rendering', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-0' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
    badgeRenders.count = 0
  })

  it('does not re-render member rows when the invite dialog opens', () => {
    renderTab()
    const afterMount = badgeRenders.count

    fireEvent.click(screen.getByRole('button', { name: 'Add a Team Member' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(badgeRenders.count).toBe(afterMount)
  })

  it('does not re-render member rows when a confirmation opens', async () => {
    renderTab()
    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Person 3' }),
    )
    const removeItem = await screen.findByRole('menuitem', {
      name: /remove from workspace/i,
    })
    const beforeConfirm = badgeRenders.count

    fireEvent.click(removeItem)

    expect(
      await screen.findByRole('alertdialog', { name: 'Remove Person 3' }),
    ).toBeInTheDocument()
    expect(badgeRenders.count).toBe(beforeConfirm)
  })
})
