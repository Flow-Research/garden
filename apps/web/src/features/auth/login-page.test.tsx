import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { LoginPage } from './login-page'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockSignInSocial = vi.hoisted(() => vi.fn())
const mockSignUp = vi.hoisted(() => vi.fn())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: {
      email: mockSignIn,
      social: mockSignInSocial,
    },
    signUp: {
      email: mockSignUp,
    },
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

function renderLoginPage(props?: Partial<ComponentProps<typeof LoginPage>>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const onSuccess = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <LoginPage onSuccess={onSuccess} {...props} />
    </QueryClientProvider>,
  )

  return { onSuccess, queryClient }
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue({})
    mockSignInSocial.mockResolvedValue({})
    mockSignUp.mockResolvedValue({})
  })

  it('shows Google only when the provider is configured', () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <LoginPage onSuccess={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(
      screen.queryByRole('button', { name: /continue with google/i }),
    ).not.toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LoginPage onSuccess={vi.fn()} googleAuthEnabled />
      </QueryClientProvider>,
    )

    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument()
  })

  it('starts Google sign-in with the default workspace redirect', async () => {
    const user = userEvent.setup()
    renderLoginPage({ googleAuthEnabled: true })

    await user.click(
      screen.getByRole('button', { name: /continue with google/i }),
    )

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/workspace',
      errorCallbackURL: 'http://localhost:3000/',
      loginHint: undefined,
    })
    expect(
      screen.getByRole('button', { name: /opening google/i }),
    ).toBeDisabled()
  })

  it('keeps the invite redirect and email hint during Google sign-in', async () => {
    const user = userEvent.setup()
    const redirectTarget = '/invitations/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
    renderLoginPage({
      googleAuthEnabled: true,
      initialEmail: 'invitee@example.com',
      lockedEmail: true,
      redirectTarget,
    })

    await user.click(
      screen.getByRole('button', { name: /continue with google/i }),
    )

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: redirectTarget,
      errorCallbackURL: 'http://localhost:3000/',
      loginHint: 'invitee@example.com',
    })
  })

  it('shows an OAuth callback error before another sign-in attempt', () => {
    renderLoginPage({
      initialError:
        'An account already exists for this email. Sign in with your password, then link Google in Settings.',
    })

    expect(
      screen.getByText(/an account already exists for this email/i),
    ).toBeInTheDocument()
  })

  it('shows a resolved Google auth error and restores the button', async () => {
    const user = userEvent.setup()
    mockSignInSocial.mockResolvedValueOnce({
      error: { message: 'Google sign-in is unavailable' },
    })
    renderLoginPage({ googleAuthEnabled: true })

    await user.click(
      screen.getByRole('button', { name: /continue with google/i }),
    )

    expect(
      await screen.findByText('Google sign-in is unavailable'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeEnabled()
    expect(mockToastError).toHaveBeenCalledWith('Google sign-in is unavailable')
  })

  it('shows a rejected Google auth request and restores the button', async () => {
    const user = userEvent.setup()
    mockSignInSocial.mockRejectedValueOnce(new Error('Network unavailable'))
    renderLoginPage({ googleAuthEnabled: true })

    await user.click(
      screen.getByRole('button', { name: /continue with google/i }),
    )

    expect(await screen.findByText('Network unavailable')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeEnabled()
    expect(mockToastError).toHaveBeenCalledWith('Network unavailable')
  })

  it('signs in with Better Auth and hands off to onSuccess', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderLoginPage()

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'password123',
      })
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('prefills and locks invite email during sign-up', async () => {
    const user = userEvent.setup()
    renderLoginPage({
      initialEmail: 'invitee@example.com',
      initialMode: 'signup',
      invitationWorkspaceName: 'Garden Dev',
      lockedEmail: true,
    })

    const emailInput = screen.getByLabelText(/email/i)
    expect(emailInput).toHaveValue('invitee@example.com')
    expect(emailInput).toHaveAttribute('readonly')
    expect(
      screen.getByText('Use this invite email to join Garden Dev.'),
    ).toBeInTheDocument()

    await user.type(emailInput, 'wrong@example.com')
    expect(emailInput).toHaveValue('invitee@example.com')
  })

  it('switches to sign-up mode and creates an account', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderLoginPage({ initialMode: 'signup' })

    await user.type(screen.getByLabelText(/^name$/i), 'Ada Lovelace')
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'password123',
      })
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('toggles password visibility', async () => {
    const user = userEvent.setup()
    renderLoginPage()

    const passwordInput = screen.getByLabelText(/^password$/i)
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: /show password/i }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: /hide password/i }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('links to password recovery with the entered email', async () => {
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText(/email/i), 'ada+garden@example.com')

    expect(
      screen.getByRole('link', { name: /forgot password/i }),
    ).toHaveAttribute(
      'href',
      '/forgot-password?email=ada%2Bgarden%40example.com',
    )
  })

  it('preserves the invitation redirect in the forgot-password link', () => {
    renderLoginPage({
      initialEmail: 'invitee@example.com',
      lockedEmail: true,
      redirectTarget: '/invitations/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    })

    expect(
      screen.getByRole('link', { name: /forgot password/i }),
    ).toHaveAttribute(
      'href',
      '/forgot-password?email=invitee%40example.com&redirect=%2Finvitations%2F9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    )
  })

  it.each([
    ['signin', /create an account/i],
    ['signup', /^sign in$/i],
  ] as const)(
    'locks %s mode during a pending invite flow',
    (mode, toggleName) => {
      renderLoginPage({
        initialEmail: 'invitee@example.com',
        initialMode: mode,
        lockedEmail: true,
        invitationWorkspaceName: 'Garden Dev',
      })

      expect(
        screen.queryByRole('button', { name: toggleName }),
      ).not.toBeInTheDocument()
    },
  )

  it('keeps privacy and terms available from the public auth surface', () => {
    renderLoginPage()

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/terms',
    )
  })

  it('shows the auth error when Better Auth rejects the request', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderLoginPage()

    mockSignIn.mockResolvedValueOnce({
      error: { message: 'Invalid email or password' },
    })

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrongpass')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument()
      expect(mockToastError).toHaveBeenCalledWith('Invalid email or password')
      expect(onSuccess).not.toHaveBeenCalled()
    })
  })
})
