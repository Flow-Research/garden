import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemberRole,
  MemberWithUser,
  User,
  Workspace,
} from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { workspaceKeys } from '@/lib/workspace/queries'
import { GeneralSettings } from './general-settings'

const mockUpdateWorkspace = vi.hoisted(() => vi.fn())
const mockLeaveWorkspace = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: { updateWorkspace: mockUpdateWorkspace },
}))
vi.mock('@/lib/workspace/mutations', () => ({
  useLeaveWorkspace: () => ({
    mutateAsync: mockLeaveWorkspace,
    isPending: false,
  }),
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
    slug: `${id}-slug`,
    description: 'Plants',
    context: null,
    settings: {},
    issue_prefix: 'GAR',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function member(role: MemberRole): MemberWithUser {
  return {
    id: 'member-1',
    workspace_id: 'ws-1',
    user_id: USER.id,
    role,
    created_at: '2026-01-01T00:00:00Z',
    name: USER.name,
    email: USER.email,
    avatar_url: null,
    github_user_id: null,
    github_login: null,
  }
}

function renderGeneral(role: MemberRole = 'admin') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), [member(role)])
  queryClient.setQueryData(workspaceKeys.list(), [
    workspace('ws-1', 'Garden'),
    workspace('ws-2', 'Orchard'),
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <GeneralSettings />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('GeneralSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: USER })
    useWorkspaceStore.setState({ workspace: workspace('ws-1', 'Garden') })
  })

  it('shows labelled fields, the context hint and the slug', () => {
    renderGeneral()
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Garden')
    expect(screen.getByLabelText('Description')).toHaveValue('Plants')
    expect(screen.getByLabelText('Context')).toHaveAccessibleDescription(
      /Agents read this/,
    )
    expect(screen.getByText('ws-1-slug')).toBeInTheDocument()
  })

  it('shows Save and Reset only after a real edit', async () => {
    const user = userEvent.setup()
    renderGeneral()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()

    // Whitespace alone is not a change.
    await user.type(screen.getByLabelText('Name'), '   ')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()

    await user.type(screen.getByLabelText('Context'), 'Grow things')
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('Context')).toHaveValue('')
    expect(screen.getByLabelText('Name')).toHaveValue('Garden')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('disables Save when the name is cleared', async () => {
    const user = userEvent.setup()
    renderGeneral()
    await user.clear(screen.getByLabelText('Name'))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('saves trimmed values and updates the store and workspace list', async () => {
    const user = userEvent.setup()
    const saved = {
      ...workspace('ws-1', 'Garden HQ'),
      context: 'Grow things',
    }
    mockUpdateWorkspace.mockResolvedValue(saved)
    const queryClient = renderGeneral()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), ' Garden HQ ')
    await user.type(screen.getByLabelText('Context'), 'Grow things  ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mockUpdateWorkspace).toHaveBeenCalledWith('ws-1', {
      name: 'Garden HQ',
      description: 'Plants',
      context: 'Grow things',
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull(),
    )
    expect(useWorkspaceStore.getState().workspace?.name).toBe('Garden HQ')
    expect(
      queryClient
        .getQueryData<Workspace[]>(workspaceKeys.list())
        ?.map((ws) => ws.name),
    ).toEqual(['Garden HQ', 'Orchard'])
  })

  it('keeps edits through a store update and drops them on a workspace switch', async () => {
    const user = userEvent.setup()
    renderGeneral()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Garden HQ')

    act(() =>
      useWorkspaceStore.setState({
        workspace: { ...workspace('ws-1', 'Garden'), updated_at: 'later' },
      }),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Garden HQ')

    act(() =>
      useWorkspaceStore.setState({ workspace: workspace('ws-2', 'Orchard') }),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Orchard')
  })

  it('locks the fields for members and says why at the top', () => {
    renderGeneral('member')
    expect(
      screen.getByText('Only admins and owners can edit workspace settings.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Description')).toBeDisabled()
    expect(screen.getByLabelText('Context')).toBeDisabled()
  })

  it('leaves the workspace after confirmation', async () => {
    const user = userEvent.setup()
    mockLeaveWorkspace.mockResolvedValue(undefined)
    renderGeneral('member')

    await user.click(screen.getByRole('button', { name: 'Leave workspace' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Leave Garden?')
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    expect(mockLeaveWorkspace).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('keeps the confirm dialog open when leaving fails', async () => {
    const user = userEvent.setup()
    mockLeaveWorkspace.mockRejectedValue(new Error('Owners cannot leave'))
    renderGeneral('owner')

    await user.click(screen.getByRole('button', { name: 'Leave workspace' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    expect(mockLeaveWorkspace).toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
