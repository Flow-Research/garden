import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RequestPasswordResetPage,
  ResetPasswordPage,
} from './password-recovery-page'

const mockRequestPasswordReset = vi.hoisted(() => vi.fn())
const mockResetPassword = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    requestPasswordReset: mockRequestPasswordReset,
    resetPassword: mockResetPassword,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}))

describe('password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestPasswordReset.mockResolvedValue({ data: { status: true } })
    mockResetPassword.mockResolvedValue({ data: { status: true } })
  })

  it('requests a reset link and renders a non-enumerating success state', async () => {
    const user = userEvent.setup()
    render(<RequestPasswordResetPage initialEmail="ada@example.com" />)

    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: 'ada@example.com',
        redirectTo: 'http://localhost:3000/reset-password',
      })
      expect(
        screen.getByRole('heading', { name: /check your email/i }),
      ).toBeInTheDocument()
      expect(screen.getByText(/if an account exists/i)).toBeInTheDocument()
    })
  })

  it('blocks mismatched new passwords before consuming the token', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage token="valid-token" invalidToken={false} />)

    await user.type(screen.getByLabelText(/^new password$/i), 'password-one')
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      'password-two',
    )
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('updates the password and returns to sign in', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage token="valid-token" invalidToken={false} />)

    await user.type(screen.getByLabelText(/^new password$/i), 'password-new')
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      'password-new',
    )
    await user.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: 'password-new',
        token: 'valid-token',
      })
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/login',
        search: { redirect: undefined },
        replace: true,
      })
    })
  })

  it('threads the invitation redirect through the whole recovery detour', async () => {
    const user = userEvent.setup()
    const inviteRedirect = '/invitations/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
    const { unmount } = render(
      <RequestPasswordResetPage
        initialEmail="ada@example.com"
        redirectTarget={inviteRedirect}
      />,
    )

    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: 'ada@example.com',
        redirectTo: `http://localhost:3000/reset-password?redirect=${encodeURIComponent(inviteRedirect)}`,
      })
    })
    unmount()

    render(
      <ResetPasswordPage
        token="valid-token"
        invalidToken={false}
        redirectTarget={inviteRedirect}
      />,
    )
    await user.type(screen.getByLabelText(/^new password$/i), 'password-new')
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      'password-new',
    )
    await user.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/login',
        search: { redirect: inviteRedirect },
        replace: true,
      })
    })
  })
})
