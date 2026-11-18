import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberWithUser, User } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { workspaceKeys } from '@/lib/workspace/queries'
import { ProfileSettings } from './profile-settings'

const mockListAccounts = vi.hoisted(() => vi.fn())
const mockListSessions = vi.hoisted(() => vi.fn())
const mockChangePassword = vi.hoisted(() => vi.fn())
const mockRevokeSession = vi.hoisted(() => vi.fn())
const mockUpdateMe = vi.hoisted(() => vi.fn())

vi.mock('@/features/navigation', () => ({
  useNavigationActions: () => ({ replace: vi.fn() }),
}))
vi.mock('@/lib/api', () => ({
  api: { updateMe: mockUpdateMe, uploadFile: vi.fn() },
}))
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        session: { id: 'session-current' },
        user: { emailVerified: true },
      },
      refetch: vi.fn(async () => undefined),
    }),
    listAccounts: mockListAccounts,
    listSessions: mockListSessions,
    changePassword: mockChangePassword,
    revokeSession: mockRevokeSession,
    revokeOtherSessions: vi.fn(async () => ({ data: {}, error: null })),
  },
}))
vi.mock('./github-workspace-identity', () => ({
  GithubWorkspaceIdentitySection: () => null,
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

const ADMIN: MemberWithUser = {
  id: 'member-1',
  workspace_id: 'ws-1',
  user_id: USER.id,
  role: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  name: USER.name,
  email: USER.email,
  avatar_url: null,
  github_user_id: null,
  github_login: null,
}

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const WINDOWS_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'

function session(id: string, userAgent: string) {
  return {
    id,
    token: `${id}-token`,
    userId: USER.id,
    userAgent,
    ipAddress: '203.0.113.7',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-18T00:00:00Z'),
    expiresAt: new Date('2026-12-18T00:00:00Z'),
  }
}

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(workspaceKeys.members('ws-1'), [ADMIN])
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <ProfileSettings />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('ProfileSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: USER })
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: 'credential' }],
      error: null,
    })
    mockListSessions.mockResolvedValue({
      data: [
        session('session-other', WINDOWS_FIREFOX),
        session('session-current', MAC_CHROME),
      ],
      error: null,
    })
    mockChangePassword.mockResolvedValue({ data: {}, error: null })
    mockRevokeSession.mockResolvedValue({ data: {}, error: null })
  })

  it('shows the name, workspace role and email verification', () => {
    renderProfile()
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('edits the name in a dialog and saves only a changed name', async () => {
    const user = userEvent.setup()
    mockUpdateMe.mockResolvedValue({ ...USER, name: 'Ada Lovelace' })
    renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('Preferred name')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(input).toHaveValue('Ada')
    expect(save).toBeDisabled()

    await user.type(input, ' Lovelace  ')
    await user.click(save)

    expect(mockUpdateMe).toHaveBeenCalledWith({ name: 'Ada Lovelace' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      screen.getByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument()
  })

  it('discards an unsaved name on cancel', async () => {
    const user = userEvent.setup()
    renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Preferred name'), ' X')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Edit name' }))
    expect(
      within(await screen.findByRole('dialog')).getByLabelText(
        'Preferred name',
      ),
    ).toHaveValue('Ada')
    expect(mockUpdateMe).not.toHaveBeenCalled()
  })

  it('hides the password row for Google-only accounts', async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: 'google' }],
      error: null,
    })
    renderProfile()

    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled())
    expect(screen.queryByText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull()
  })

  it('changes the password once the confirmation matches', async () => {
    const user = userEvent.setup()
    renderProfile()

    await user.click(
      await screen.findByRole('button', { name: 'Change password' }),
    )
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Change password',
    })

    const newPassword = within(dialog).getByLabelText('New password')
    expect(newPassword).toHaveAccessibleDescription(
      'Use at least 8 characters.',
    )
    expect(newPassword).toHaveAttribute('type', 'password')
    await user.click(
      within(dialog).getByRole('button', { name: 'Show new password' }),
    )
    expect(newPassword).toHaveAttribute('type', 'text')

    await user.type(within(dialog).getByLabelText('Current password'), 'old')
    await user.type(newPassword, 'new-pass1')
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      'new-pass2',
    )
    expect(within(dialog).getByText('Passwords do not match')).toBeVisible()
    expect(submit).toBeDisabled()

    await user.clear(within(dialog).getByLabelText('Confirm new password'))
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      'new-pass1',
    )
    await user.click(submit)

    expect(mockChangePassword).toHaveBeenCalledWith({
      currentPassword: 'old',
      newPassword: 'new-pass1',
      revokeOtherSessions: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('lists the current session first and signs out another session', async () => {
    const user = userEvent.setup()
    renderProfile()

    await screen.findByText('This device')
    const rows = screen.getAllByRole('row')
    // Header row, then the current session.
    expect(within(rows[1]).getByText('macOS')).toBeInTheDocument()
    expect(within(rows[1]).getByText('This device')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Firefox')).toBeInTheDocument()
    // Garden does not record client IPs, so the column is not shown.
    expect(screen.queryByText('IP address')).toBeNull()
    expect(screen.queryByText('203.0.113.7')).toBeNull()

    await user.click(
      screen.getByRole('button', { name: 'Sign out Firefox on Windows' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Sign out this session?')).toBeVisible()
    expect(mockRevokeSession).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))
    expect(mockRevokeSession).toHaveBeenCalledWith({
      token: 'session-other-token',
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('asks before signing out of this device and keeps the session on cancel', async () => {
    const user = userEvent.setup()
    const logout = vi.fn(async () => undefined)
    useAuthStore.setState({ logout })
    renderProfile()

    await user.click(
      screen.getByRole('button', { name: 'Sign out of this device' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Sign out of this device?')).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(logout).not.toHaveBeenCalled()
  })
})
