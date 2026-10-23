import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberWithUser, User, Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { workspaceKeys } from '@/lib/workspace/queries'
import { AccountTab } from './account-tab'
import { WorkspaceTab } from './workspace-tab'

vi.mock('@/features/navigation', () => ({
  useNavigation: () => ({ replace: vi.fn() }),
}))
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false, error: null }),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
  },
}))
vi.mock('./google-account-connection', () => ({
  GoogleAccountConnection: () => null,
}))

const USER: User = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function workspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    slug: id,
    description: null,
    context: null,
    settings: {},
    issue_prefix: 'GAR',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const OWNER: MemberWithUser = {
  id: 'member-1',
  workspace_id: 'ws-1',
  user_id: USER.id,
  role: 'owner',
  created_at: '2026-01-01T00:00:00Z',
  name: USER.name,
  email: USER.email,
  avatar_url: null,
}

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), [OWNER])
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">{ui}</WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('settings forms keep typed input', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: USER })
    useWorkspaceStore.setState({ workspace: workspace('ws-1', 'Garden') })
  })

  it('keeps an unsaved profile name when the user object changes', () => {
    renderWithClient(<AccountTab />)

    fireEvent.change(screen.getByPlaceholderText('Your name'), {
      target: { value: 'Ada Lovelace' },
    })
    // e.g. an avatar upload replaces the user object
    act(() => useAuthStore.setState({ user: { ...USER, avatar_url: 'a.png' } }))

    expect(screen.getByPlaceholderText('Your name')).toHaveValue('Ada Lovelace')
  })

  it('names the avatar button', () => {
    renderWithClient(<AccountTab />)
    expect(
      screen.getByRole('button', { name: 'Change avatar' }),
    ).toBeInTheDocument()
  })

  it('keeps unsaved workspace edits on a store update, and resets on a switch', () => {
    renderWithClient(<WorkspaceTab />)

    fireEvent.change(screen.getByDisplayValue('Garden'), {
      target: { value: 'Garden HQ' },
    })
    act(() =>
      useWorkspaceStore.setState({
        workspace: { ...workspace('ws-1', 'Garden'), updated_at: 'later' },
      }),
    )
    expect(screen.getByDisplayValue('Garden HQ')).toBeTruthy()

    act(() =>
      useWorkspaceStore.setState({ workspace: workspace('ws-2', 'Orchard') }),
    )
    expect(screen.getByDisplayValue('Orchard')).toBeTruthy()
  })
})
