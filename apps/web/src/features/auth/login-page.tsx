import { useState } from 'react'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { toast } from 'sonner'
import { LoginForm } from '@/components/login-form'
import { authClient } from '@/lib/auth/client'
import {
  capturePostHogBrowserEvent,
  postHogBrowserClient,
} from '@/lib/posthog-browser'

export function LoginPage({
  onSuccess,
  initialEmail,
  initialMode = 'signin',
  invitationStatusMessage,
  invitationWorkspaceName,
  lockedEmail = false,
}: {
  onSuccess: () => void
  initialEmail?: string
  initialMode?: 'signin' | 'signup'
  invitationStatusMessage?: string
  invitationWorkspaceName?: string
  lockedEmail?: boolean
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <LoginForm
        className="w-full max-w-5xl"
        mode={mode}
        name={name}
        email={email}
        password={password}
        error={error}
        loading={loading}
        onSubmit={handleSubmit}
        onNameChange={setName}
        emailReadonly={lockedEmail}
        invitationStatusMessage={invitationStatusMessage}
        invitationWorkspaceName={invitationWorkspaceName}
        onEmailChange={lockedEmail ? () => undefined : setEmail}
        onPasswordChange={setPassword}
        onToggleMode={() =>
          setMode((current) => (current === 'signin' ? 'signup' : 'signin'))
        }
      />
    </div>
  )
}
