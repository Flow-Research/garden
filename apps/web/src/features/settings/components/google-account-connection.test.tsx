import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleAccountConnection } from './google-account-connection'

const mockGetAuthProviderAvailability = vi.hoisted(() => vi.fn())
const mockListAccounts = vi.hoisted(() => vi.fn())
const mockLinkSocial = vi.hoisted(() => vi.fn())
const mockUnlinkAccount = vi.hoisted(() => vi.fn())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/auth-providers', () => ({
  getAuthProviderAvailability: mockGetAuthProviderAvailability,
}))

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    listAccounts: mockListAccounts,
    linkSocial: mockLinkSocial,
    unlinkAccount: mockUnlinkAccount,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

function renderGoogleAccountConnection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <GoogleAccountConnection />
    </QueryClientProvider>,
  )

  return queryClient
}

describe('GoogleAccountConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthProviderAvailability.mockResolvedValue({ google: true })
    mockListAccounts.mockResolvedValue({
      data: [
        {
          id: 'credential-account',
          accountId: 'user-id',
          providerId: 'credential',
        },
      ],
    })
    mockLinkSocial.mockResolvedValue({})
    mockUnlinkAccount.mockResolvedValue({})
  })

  it('stays hidden when Google auth is not configured', async () => {
    mockGetAuthProviderAvailability.mockResolvedValueOnce({ google: false })
    renderGoogleAccountConnection()

    await waitFor(() =>
      expect(mockGetAuthProviderAvailability).toHaveBeenCalledTimes(1),
    )
    expect(
      screen.queryByRole('heading', { name: /linked accounts/i }),
    ).not.toBeInTheDocument()
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  it('lets a password user start explicit Google linking', async () => {
    const user = userEvent.setup()
    renderGoogleAccountConnection()

    await user.click(
      await screen.findByRole('button', { name: /link google/i }),
    )

    expect(mockLinkSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: window.location.href,
    })
    expect(
      screen.getByRole('button', { name: /opening google/i }),
    ).toBeDisabled()
  })

  it('does not offer unlink when Google is the only sign-in method', async () => {
    mockListAccounts.mockResolvedValueOnce({
      data: [
        {
          id: 'google-account',
          accountId: 'google-user-id',
          providerId: 'google',
        },
      ],
    })
    renderGoogleAccountConnection()

    expect(
      await screen.findByText('Google is your only sign-in method.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /unlink/i }),
    ).not.toBeInTheDocument()
  })

  it('does not count a connector as another sign-in method', async () => {
    mockListAccounts.mockResolvedValueOnce({
      data: [
        {
          id: 'google-account',
          accountId: 'google-user-id',
          providerId: 'google',
        },
        {
          id: 'gmail-connector',
          accountId: 'gmail-user-id',
          providerId: 'gmail',
        },
      ],
    })
    renderGoogleAccountConnection()

    expect(
      await screen.findByText('Google is your only sign-in method.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /unlink/i }),
    ).not.toBeInTheDocument()
  })

  it('unlinks Google when another sign-in method remains', async () => {
    const user = userEvent.setup()
    mockListAccounts.mockResolvedValue({
      data: [
        {
          id: 'credential-account',
          accountId: 'user-id',
          providerId: 'credential',
        },
        {
          id: 'google-account',
          accountId: 'google-user-id',
          providerId: 'google',
        },
      ],
    })
    renderGoogleAccountConnection()

    await user.click(await screen.findByRole('button', { name: /unlink/i }))

    await waitFor(() => {
      expect(mockUnlinkAccount).toHaveBeenCalledWith({
        providerId: 'google',
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('Google unlinked')
    })
    expect(mockListAccounts).toHaveBeenCalledTimes(2)
  })

  it('shows a retry action when linked accounts cannot load', async () => {
    mockListAccounts.mockResolvedValueOnce({
      error: { message: 'Could not reach Better Auth' },
    })
    renderGoogleAccountConnection()

    expect(
      await screen.findByText('Could not reach Better Auth'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled()
  })
})
