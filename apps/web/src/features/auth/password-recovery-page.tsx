import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
import { ArrowLeftIcon, ArrowRightIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import { Button, buttonVariants } from '@garden/ui/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@garden/ui/components/ui/field'
import { Input } from '@garden/ui/components/ui/input'
import { LoginFoliage } from '@/components/login-foliage'
import { authClient } from '@/lib/auth/client'

class PasswordRecoveryError extends TaggedError('PasswordRecoveryError')<{
  message: string
}>() {}

type AuthResponse = {
  data?: unknown
  error?: { message?: string | null } | null
}

/**
 * Normalizes Better Auth's transport rejection and response-level error into a
 * single typed result. This keeps both recovery forms on one boundary match and
 * avoids divergent toast/form error behavior. Source: installed Better Auth
 * v1.6.26 request-password-reset and reset-password route implementations.
 */
async function runRecoveryRequest(request: Promise<AuthResponse>) {
  const response = await Result.tryPromise({
    try: () => request,
    catch: (cause) =>
      new PasswordRecoveryError({
        message:
          cause instanceof Error ? cause.message : 'Password recovery failed',
      }),
  })

  return response.andThen((value) =>
    value.error
      ? Result.err(
          new PasswordRecoveryError({
            message: value.error.message || 'Password recovery failed',
          }),
        )
      : Result.ok(value.data),
  )
}

export function RequestPasswordResetPage({
  initialEmail = '',
  redirectTarget,
}: {
  initialEmail?: string
  /**
   * Sanitized post-auth target (usually an invite link). Appended to the
   * emailed reset URL so completing recovery returns to the original flow.
   */
  redirectTarget?: string
}) {
  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  /** Requests a link without revealing whether the account exists. */
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    const resetUrl = new URL('/reset-password', window.location.origin)
    if (redirectTarget) resetUrl.searchParams.set('redirect', redirectTarget)

    void runRecoveryRequest(
      authClient.requestPasswordReset({
        email,
        redirectTo: resetUrl.href,
      }),
    )
      .then((result) =>
        result.match({
          ok: () => {
            setSent(true)
            toast.success('Check your email for a reset link')
          },
          err: (requestError) => {
            setError(requestError.message)
            toast.error(requestError.message)
          },
        }),
      )
      .finally(() => setLoading(false))
  }

  return (
    <RecoveryShell
      title={sent ? 'Check your email' : 'Reset your password'}
      subtitle={
        sent
          ? `If an account exists for ${email}, a reset link is on its way.`
          : 'Enter your account email and we’ll send a secure reset link.'
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSent(false)}
          >
            Send another link
          </Button>
          <BackToSignIn redirectTarget={redirectTarget} />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="recovery-email">Email</FieldLabel>
              <Input
                id="recovery-email"
                className="h-10 bg-bone/60"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
                required
              />
            </Field>
            <FieldError>{error}</FieldError>
            <Field>
              <Button type="submit" className="h-10 w-full" disabled={loading}>
                {loading ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <ArrowRightIcon className="size-4" />
                )}
                {loading ? 'Sending link...' : 'Send reset link'}
              </Button>
            </Field>
            <BackToSignIn redirectTarget={redirectTarget} />
          </FieldGroup>
        </form>
      )}
    </RecoveryShell>
  )
}

export function ResetPasswordPage({
  token,
  invalidToken,
  redirectTarget,
}: {
  token?: string
  invalidToken: boolean
  /** Sanitized post-auth target preserved from the emailed reset URL. */
  redirectTarget?: string
}) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cannotReset = invalidToken || !token

  /** Validates matching passwords locally, then consumes the one-time token. */
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    if (password !== confirmation) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    setError('')
    void runRecoveryRequest(
      authClient.resetPassword({ newPassword: password, token }),
    )
      .then((result) =>
        result.match({
          ok: () => {
            toast.success('Password updated. Sign in with your new password.')
            void navigate({
              to: '/login',
              search: { redirect: redirectTarget },
              replace: true,
            })
          },
          err: (requestError) => {
            setError(requestError.message)
            toast.error(requestError.message)
          },
        }),
      )
      .finally(() => setLoading(false))
  }

  return (
    <RecoveryShell
      title={cannotReset ? 'Reset link expired' : 'Choose a new password'}
      subtitle={
        cannotReset
          ? 'This reset link is invalid or has expired. Request a fresh link to continue.'
          : 'Use at least 8 characters. Your old password will stop working immediately.'
      }
    >
      {cannotReset ? (
        <div className="space-y-4">
          <Link
            to="/forgot-password"
            search={{ email: undefined, redirect: redirectTarget }}
            className={buttonVariants({ className: 'w-full' })}
          >
            Request a new link
            <ArrowRightIcon className="size-4" />
          </Link>
          <BackToSignIn redirectTarget={redirectTarget} />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                className="h-10 bg-bone/60"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">
                Confirm new password
              </FieldLabel>
              <Input
                id="confirm-password"
                className="h-10 bg-bone/60"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <FieldError>{error}</FieldError>
            <Field>
              <Button type="submit" className="h-10 w-full" disabled={loading}>
                {loading ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <ArrowRightIcon className="size-4" />
                )}
                {loading ? 'Updating password...' : 'Update password'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      )}
    </RecoveryShell>
  )
}

/**
 * Shared shell for both recovery forms, matching the redesigned login (Aug
 * 2026): arched vellum panel on the parchment ground, leaf mark, prose-face
 * greeting, foliage bed behind. Unlike the login, the subtitle stays — the
 * recovery flows genuinely need their one line of instruction.
 */
function RecoveryShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10">
      <LoginFoliage className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto h-[clamp(180px,34vh,330px)] w-full max-w-6xl text-brand" />
      <div className="login-panel-enter vellum-heavy relative z-10 w-full max-w-sm rounded-t-[7rem] rounded-b-2xl px-7 pt-14 pb-8 sm:px-9">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <BrandIcon className="size-6" noSpin />
          </span>
          <h1 className="font-prose text-[1.65rem] leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  )
}

function BackToSignIn({ redirectTarget }: { redirectTarget?: string }) {
  return (
    <FieldDescription className="text-center">
      <Link
        to="/login"
        search={{ redirect: redirectTarget }}
        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to sign in
      </Link>
    </FieldDescription>
  )
}
