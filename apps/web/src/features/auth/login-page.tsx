'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@accelerate/core/api'
import { useAuthStore } from '@accelerate/core/auth'
import { useWorkspaceStore } from '@accelerate/core/workspace'
import { workspaceKeys } from '@accelerate/core/workspace/queries'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { LoginForm } from '@/components/login-form'

export function LoginPage({
  onSuccess,
  initialMode = 'signin',
}: {
  onSuccess: () => void
  initialMode?: 'signin' | 'signup'
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result =
        mode === 'signin'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ name, email, password })

      if (result?.error) {
        throw new Error(result.error.message || 'Authentication failed')
      }

      const { user, workspaces } = await api.bootstrap()
      useAuthStore.getState().setUser(user)
      qc.setQueryData(workspaceKeys.list(), workspaces)
      const activeWorkspace = useWorkspaceStore
        .getState()
        .hydrateWorkspace(workspaces)
      if (activeWorkspace) {
        void authClient.organization.setActive({
          organizationId: activeWorkspace.id,
        })
      }
      toast.success(mode === 'signin' ? 'Signed in' : 'Account created', {
        description:
          workspaces.length > 0
            ? 'Redirecting to your workspace.'
            : "You're in. Set up your first workspace next.",
      })
      onSuccess()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
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
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onToggleMode={() =>
          setMode((current) => (current === 'signin' ? 'signup' : 'signin'))
        }
      />
    </div>
  )
}
