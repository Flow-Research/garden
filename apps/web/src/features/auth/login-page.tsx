import { useState } from 'react'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { toast } from 'sonner'
import { LoginForm } from '@/components/login-form'
import { LoginFoliage } from '@/components/login-foliage'
import { authClient } from '@/lib/auth/client'
import { authClientOperation } from '@/lib/auth/client-result'
import {
  capturePostHogBrowserEvent,
  postHogBrowserClient,
} from '@/lib/posthog-browser'

/**
 * Owns Garden's public authentication surface and its account-mode state.
 * Privacy and terms now remain visible below the panel because `/login` is the
 * current landing page after `/` redirects unauthenticated visitors here.
 */
export function LoginPage({
  onSuccess,
  initialEmail,
  initialMode = 'signin',
  invitationStatusMessage,
  invitationWorkspaceName,
  lockedEmail = false,
  redirectTarget,
  googleAuthEnabled = false,
  initialError,
}: {
  onSuccess: () => void
  googleAuthEnabled?: boolean
  initialEmail?: string
  initialError?: string
  initialMode?: 'signin' | 'signup'
  invitationStatusMessage?: string
  invitationWorkspaceName?: string
  lockedEmail?: boolean
  /**
   * Sanitized post-auth target (usually an invite link). Threaded into the
   * forgot-password link so the recovery detour returns to the same flow.
   */
  redirectTarget?: string
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  /**
   * Starts Google OAuth with the route's sanitized destination. Invitation
   * pages also send the locked invite email as a login hint. Google can suggest
   * that account, while server-side invitation acceptance remains the final
   * matching-email check. Better Auth can reject the request or resolve with an
   * error payload, so `authClientOperation` normalizes both failure paths.
   */
  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    setError('')

    const result = await authClientOperation({
      fallbackMessage: 'Could not continue with Google',
      operation: 'google-sign-in',
      request: () =>
        authClient.signIn.social({
          provider: 'google',
          callbackURL: redirectTarget ?? '/workspace',
          errorCallbackURL: currentOAuthErrorCallbackURL(),
          loginHint: lockedEmail ? email : undefined,
        }),
    })

    result.match({
      ok: () => undefined,
      err: (requestError) => {
        setGoogleLoading(false)
        setError(requestError.message)
        toast.error(requestError.message)
      },
    })
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    const request =
      mode === 'signin'
        ? authClient.signIn.email({ email, password })
        : authClient.signUp.email({ name, email, password })

    void request
      .then((result) => {
        if (result?.error) {
          const message = result.error.message || 'Authentication failed'
          setError(message)
          toast.error(message)
          return
        }

        const authenticatedUser = result.data?.user
        if (authenticatedUser) {
          postHogBrowserClient.identify(authenticatedUser.id, {
            email: authenticatedUser.email,
            name: authenticatedUser.name,
          })
          capturePostHogBrowserEvent(
            mode === 'signin'
              ? GARDEN_ANALYTICS_EVENTS.userSignedIn
              : GARDEN_ANALYTICS_EVENTS.userSignedUp,
            {
              email: authenticatedUser.email,
              name: authenticatedUser.name,
            },
          )
        }

        toast.success(mode === 'signin' ? 'Signed in' : 'Account created')
        onSuccess()
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Authentication failed'
        setError(message)
        toast.error(message)
      })
      .finally(() => setLoading(false))
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-y-auto px-6 py-6">
      <LoginFoliage className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto h-[clamp(180px,34vh,330px)] w-full max-w-6xl text-brand" />
      <main className="flex flex-1 items-center justify-center py-4">
        <LoginForm
          className="relative z-10 w-full max-w-sm"
          mode={mode}
          name={name}
          email={email}
          password={password}
          error={error}
          loading={loading}
          googleAuthEnabled={googleAuthEnabled}
          googleLoading={googleLoading}
          onGoogleSignIn={() => void handleGoogleSignIn()}
          onSubmit={handleSubmit}
          onNameChange={setName}
          emailReadonly={lockedEmail}
          modeLocked={lockedEmail}
          invitationStatusMessage={invitationStatusMessage}
          invitationWorkspaceName={invitationWorkspaceName}
          redirectTarget={redirectTarget}
          onEmailChange={lockedEmail ? () => undefined : setEmail}
          onPasswordChange={setPassword}
          onToggleMode={() =>
            setMode((current) => (current === 'signin' ? 'signup' : 'signin'))
          }
        />
      </main>
      <footer className="relative z-10 flex items-center justify-center gap-4 pt-3 text-xs text-muted-foreground">
        <a
          href="/privacy"
          className="transition-colors hover:text-foreground hover:underline hover:underline-offset-4"
        >
          Privacy
        </a>
        <a
          href="/terms"
          className="transition-colors hover:text-foreground hover:underline hover:underline-offset-4"
        >
          Terms
        </a>
      </footer>
    </div>
  )
}

/**
 * Returns OAuth failures to the current Garden auth route. Better Auth otherwise
 * uses its generic error page. Old OAuth error parameters are removed so a retry
 * produces one current error code while preserving the invitation redirect.
 */
function currentOAuthErrorCallbackURL() {
  const url = new URL(window.location.href)
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  return url.toString()
}
