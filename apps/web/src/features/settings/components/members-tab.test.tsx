import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberWithUser, User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { workspaceKeys } from '@/lib/workspace/queries'
import { MembersTab } from './members-tab'

const api = vi.hoisted(() => ({
  createMember: vi.fn(),
  listMembers: vi.fn(),
  listWorkspaceInvitations: vi.fn(async () => []),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const OWNER = {
  id: 'member-1',
  workspace_id: 'ws-1',
  user_id: 'user-1',
  role: 'owner',
  created_at: '2026-01-01T00:00:00Z',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
} as MemberWithUser

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), [OWNER])
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <MembersTab />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return screen.getByRole('textbox', { name: 'Email address to invite' })
}

describe('MembersTab invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'user-1' } as User })
    useWorkspaceStore.setState({
      workspace: { id: 'ws-1', name: 'Garden' } as Workspace,
    })
  })

  it('sends one invitation when Enter is pressed twice', async () => {
    let finish: () => void = () => {}
    api.createMember.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    const email = renderTab()
    fireEvent.change(email, { target: { value: ' grace@example.com ' } })

    fireEvent.submit(email)
    fireEvent.submit(email)

    expect(api.createMember).toHaveBeenCalledTimes(1)
    expect(api.createMember).toHaveBeenCalledWith('ws-1', {
      email: 'grace@example.com',
      role: 'member',
    })
    finish()
    expect(await screen.findByDisplayValue('')).toBe(email)
  })

  it('does not send an invalid address', () => {
    const email = renderTab()
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    fireEvent.submit(email)

    expect(api.createMember).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Enter a valid email address')
  })
})
