import { useState } from 'react'
import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'
import { Card, CardContent } from '@garden/ui/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@garden/ui/components/ui/field'
import { Input } from '@garden/ui/components/ui/input'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import { ArrowRightIcon, EyeIcon, EyeOffIcon, Loader2Icon } from 'lucide-react'

export function LoginForm({
  className,
  mode,
  name,
  email,
  emailReadonly,
  invitationStatusMessage,
  invitationWorkspaceName,
  password,
  error,
  loading,
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
  invitationStatusMessage?: string
  invitationWorkspaceName?: string
  password: string
  error?: string
  loading?: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onToggleMode: () => void
}) {
  const [showPassword, setShowPassword] = useState(false)
  const isSignup = mode === 'signup'
  const title = isSignup
    ? 'Create your workspace account'
    : invitationWorkspaceName
      ? 'Sign in to accept invitation'
      : 'Welcome back'
  const subtitle = isSignup
    ? invitationWorkspaceName
      ? `Use this invite email to join ${invitationWorkspaceName}.`
      : 'Start with email and password. The workspace opens right after.'
    : invitationWorkspaceName
      ? `Use the invited account to join ${invitationWorkspaceName}.`
      : 'Sign in to pick up where the workspace left off.'

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <Card className="overflow-hidden border-border/70 bg-background p-0 shadow-sm">
        <CardContent className="grid p-0 md:grid-cols-[minmax(0,1fr)_22rem]">
          <form className="p-6 md:p-8" onSubmit={onSubmit}>
            <FieldGroup>
              <div className="flex flex-col gap-2 text-left">
                <div className="inline-flex size-9 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-foreground">
                  <BrandIcon className="size-4" noSpin />
                </div>
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {title}
                  </h1>
                  <p className="text-sm text-muted-foreground">{subtitle}</p>
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
              </div>

              {isSignup ? (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
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
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    placeholder="Password"
                    autoComplete={
                      isSignup ? 'new-password' : 'current-password'
                    }
                    minLength={8}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <ArrowRightIcon className="size-4" />
                  )}
                  {loading
                    ? isSignup
                      ? 'Creating account...'
                      : 'Signing in...'
                    : isSignup
                      ? 'Create account'
                      : 'Sign in'}
                </Button>
              </Field>

              <FieldDescription className="text-left">
                {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
                <button
                  type="button"
                  onClick={onToggleMode}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  {isSignup ? 'Sign in' : 'Create one'}
                </button>
              </FieldDescription>
            </FieldGroup>
          </form>

          <div className="hidden border-l border-border/70 bg-muted/20 md:flex md:flex-col md:justify-between md:p-8">
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Workspace
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  Agents, issues, skills, and runtime state in one place.
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Keep the shell focused. Sign in, land in the workspace, and
                  keep the control plane close.
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-background/80 p-4">
              <div className="text-sm font-medium text-foreground">
                Session-backed auth
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Profile and security live in the account panel.</li>
                <li>Session revocation is available from settings.</li>
                <li>Workspace routing stays gated behind auth.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <FieldDescription className="px-1 text-center">
        By continuing, you agree to the workspace policies and session rules.
      </FieldDescription>
    </div>
  )
}
