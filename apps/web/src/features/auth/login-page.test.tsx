import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { LoginPage } from './login-page'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockSignUp = vi.hoisted(() => vi.fn())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: {
      email: mockSignIn,
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
    mockSignUp.mockResolvedValue({})
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
