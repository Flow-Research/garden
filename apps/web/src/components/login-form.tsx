import { useState } from 'react'
import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@garden/ui/components/ui/field'
import { Input } from '@garden/ui/components/ui/input'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { BrandGoogleIcon } from '@/components/icons/brand-google-icon'

/**
 * Auth panel for sign-in / sign-up.
 *
 * Why this shape: redesigned Aug 2026 to land on Garden's locked visual
 * language (parchment + vellum + foliage — see packages/ui/styles/tokens.css)
 * instead of the old generic two-column card. The previous right-hand
 * marketing rail was filler and is intentionally gone; the greeting carries no
 * subtitle unless an invitation flow needs its functional line. Sign-up now
 * includes the real legal acknowledgement required for account creation.
 *
 * The deep-arched top ("greenhouse window") frames the brand mark and
 * greeting; the form lives in the rectangular zone below. The greeting is set
 * in the system's prose face (var(--font-prose)), controls stay in the UI sans.
 * Behavior contract (labels, button names, show/hide password, forgot link)
 * is unchanged and covered by existing tests.
 */
export function LoginForm({
  className,
  mode,
  name,
  email,
  emailReadonly,
  modeLocked = false,
  invitationStatusMessage,
  invitationWorkspaceName,
  password,
  error,
  loading,
  googleAuthEnabled = false,
  googleLoading = false,
  redirectTarget,
  onGoogleSignIn,
  onSubmit,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onToggleMode,
}: React.ComponentProps<'div'> & {
  mode: 'signin' | 'signup'
  name: string
  email: string
  emailReadonly?: boolean
  /**
   * Hides the sign-in/sign-up toggle. Invitation flows pick the correct mode
   * server-side (existing users sign in, new users sign up); letting the user
   * flip manually strands them in the wrong auth mode with a locked email.
   */
  modeLocked?: boolean
  invitationStatusMessage?: string
  invitationWorkspaceName?: string
  password: string
  error?: string
  loading?: boolean
  googleAuthEnabled?: boolean
  googleLoading?: boolean
  redirectTarget?: string
  onGoogleSignIn?: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onToggleMode: () => void
}) {
  const [showPassword, setShowPassword] = useState(false)
  const isSignup = mode === 'signup'
  const title = isSignup ? 'Welcome in.' : 'Welcome back.'
  const invitationLine = invitationWorkspaceName
    ? isSignup
      ? `Use this invite email to join ${invitationWorkspaceName}.`
      : `Use the invited account to join ${invitationWorkspaceName}.`
    : undefined
  // Keeps the invitation redirect alive through the recovery detour so a reset
  // returns the user to the invite instead of a bare workspace.
  const forgotPasswordHref = (() => {
    const params = new URLSearchParams()
    const trimmedEmail = email.trim()
    if (trimmedEmail) params.set('email', trimmedEmail)
    if (redirectTarget) params.set('redirect', redirectTarget)
    const query = params.toString()
    return query ? `/forgot-password?${query}` : '/forgot-password'
  })()

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="login-panel-enter vellum-heavy rounded-t-[7rem] rounded-b-2xl px-7 pt-14 pb-8 shadow-5 sm:px-9">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <BrandIcon className="size-6" animate noSpin />
          </span>
          <h1 className="font-prose text-[1.65rem] leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          {invitationLine ? (
            <p className="text-sm text-muted-foreground">{invitationLine}</p>
          ) : null}
          {invitationStatusMessage ? (
            <p
              aria-atomic="true"
              aria-live="polite"
              role="status"
              className="text-sm font-medium text-destructive"
            >
              {invitationStatusMessage}
            </p>
          ) : null}
        </div>

        <form className="mt-8" onSubmit={onSubmit}>
          <FieldGroup className="gap-5">
            {googleAuthEnabled ? (
              <>
                <Field>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full bg-card/60"
                    disabled={loading || googleLoading}
                    onClick={onGoogleSignIn}
                  >
                    {googleLoading ? (
                      <Spinner aria-hidden="true" />
                    ) : (
                      <BrandGoogleIcon className="size-4" aria-hidden="true" />
                    )}
                    {googleLoading
                      ? 'Opening Google...'
                      : 'Continue with Google'}
                  </Button>
                </Field>

                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}

            {isSignup ? (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  className="h-10 bg-card/60"
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  autoFocus
                  required
                />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                className="h-10 bg-card/60"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus={!isSignup && !emailReadonly}
                readOnly={emailReadonly}
                required
              />
              {emailReadonly ? (
                <FieldDescription>
                  This email comes from your workspace invitation.
                </FieldDescription>
              ) : null}
            </Field>

            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                {!isSignup ? (
                  <a
                    href={forgotPasswordHref}
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4"
                  >
                    Forgot password?
                  </a>
                ) : null}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="h-10 bg-card/60 pr-10"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="Password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  autoFocus={!isSignup && emailReadonly}
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </Field>

            <FieldError>{error}</FieldError>

            <Field>
              <Button
                type="submit"
                className="h-10 w-full"
                disabled={loading || googleLoading}
              >
                {loading ? <Spinner aria-hidden="true" /> : null}
                {loading
                  ? isSignup
                    ? 'Creating account...'
                    : 'Signing in...'
                  : isSignup
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </Field>

            {modeLocked ? null : (
              <FieldDescription className="text-center">
                {isSignup ? 'Already have an account?' : 'New here?'}{' '}
                <button
                  type="button"
                  onClick={onToggleMode}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  {isSignup ? 'Sign in' : 'Create an account'}
                </button>
              </FieldDescription>
            )}
            {isSignup ? (
              <FieldDescription className="text-center text-[11px] leading-4">
                By creating an account, you agree to our{' '}
                <a
                  href="/terms"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Terms
                </a>{' '}
                and acknowledge our{' '}
                <a
                  href="/privacy"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Privacy Policy
                </a>
                .
              </FieldDescription>
            ) : null}
          </FieldGroup>
        </form>
      </div>
    </div>
  )
}
