import { useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
} from 'lucide-react'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Button } from '@garden/ui/components/ui/button'
import { Badge } from '@garden/ui/components/ui/badge'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import { toast } from 'sonner'
import { useAuthStore } from '@garden/app-state/auth'
import { api } from '@/lib/api'
import { useFileUpload } from '@garden/app-state/hooks/use-file-upload'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useNavigation } from '@/features/navigation'
import { authClient } from '@/lib/auth/client'

const sessionQueryKey = ['account', 'sessions']

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Unavailable'
  return format(new Date(value), "MMM d, yyyy 'at' h:mm a")
}

function formatRelativeTime(value: string | Date | null | undefined) {
  if (!value) return 'Unavailable'
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true })
}

function describeUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return 'Current browser session'
  return userAgent.replace(/\s+/g, ' ').trim()
}

export function AccountTab() {
  const queryClient = useQueryClient()
  const { replace } = useNavigation()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const authLogout = useAuthStore((s) => s.logout)

  const [profileName, setProfileName] = useState(user?.name ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [revokeAfterPasswordChange, setRevokeAfterPasswordChange] =
    useState(true)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [revokingOtherSessions, setRevokingOtherSessions] = useState(false)
  const [revokingToken, setRevokingToken] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const { upload, uploading } = useFileUpload(api)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    data: authSessionData,
    isPending: sessionPending,
    refetch: refetchSession,
  } = authClient.useSession()

  const {
    data: sessions = [],
    isPending: sessionsPending,
    refetch,
  } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const result = await authClient.listSessions()
      if (result.error) {
        throw new Error(result.error.message || 'Failed to load sessions')
      }
      return result.data ?? []
    },
  })

  useEffect(() => {
    setProfileName(user?.name ?? '')
  }, [user])

  const initials = (user?.name ?? user?.email ?? '')
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const currentSessionId = authSessionData?.session?.id ?? null
  const otherSessions = useMemo(
    () => sessions.filter((session) => session.id !== currentSessionId),
    [currentSessionId, sessions],
  )

  const refreshSessionState = async () => {
    await Promise.all([refetch(), refetchSession()])
  }

  const handleAvatarUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    event.target.value = ''

    try {
      const result = await upload(file)
      if (!result) return
      const updated = await api.updateMe({ avatar_url: result.link })
      setUser(updated)
      toast.success('Avatar updated')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to upload avatar',
      )
    }
  }

  const handleProfileSave = async () => {
    setProfileSaving(true)
    try {
      const updated = await api.updateMe({ name: profileName.trim() })
      setUser(updated)
      toast.success('Account updated')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update profile',
      )
    } finally {
      setProfileSaving(false)
    }
  }

  const handlePasswordSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setPasswordSaving(true)

    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: revokeAfterPasswordChange,
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to change password')
      }

      setCurrentPassword('')
      setNewPassword('')
      toast.success('Password updated')
      await refreshSessionState()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to change password',
      )
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleRevokeOtherSessions = async () => {
    setRevokingOtherSessions(true)
    try {
      const result = await authClient.revokeOtherSessions()
      if (result.error) {
        throw new Error(
          result.error.message || 'Failed to revoke other sessions',
        )
      }
      toast.success('Other sessions signed out')
      await refreshSessionState()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to revoke other sessions',
      )
    } finally {
      setRevokingOtherSessions(false)
    }
  }

  const handleRevokeSession = async (token: string) => {
    setRevokingToken(token)
    try {
      const result = await authClient.revokeSession({ token })
      if (result.error) {
        throw new Error(result.error.message || 'Failed to revoke session')
      }
      toast.success('Session signed out')
      await refreshSessionState()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to revoke session',
      )
    } finally {
      setRevokingToken(null)
    }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await authLogout()
      queryClient.clear()
      useWorkspaceStore.getState().clearWorkspace()
      toast.success('Signed out')
      replace('/login')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sign out')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="space-y-12">
      {/* Profile */}
      <section className="space-y-5">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Profile</h2>
            <p className="text-sm text-muted-foreground">
              Your name and avatar across the workspace.
            </p>
          </div>
          <Badge
            variant={
              authSessionData?.user?.emailVerified ? 'secondary' : 'outline'
            }
          >
            {authSessionData?.user?.emailVerified
              ? 'Email verified'
              : 'Email not verified'}
          </Badge>
        </header>

        <div className="flex items-start gap-6">
          <div className="space-y-2">
            <button
              type="button"
              className="group relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-semibold text-muted-foreground">
                  {initials}
                </span>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-white" />
                ) : (
                  <Camera className="size-5 text-white" />
                )}
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>

          <div className="flex-1 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user?.email ?? ''} readOnly disabled />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleProfileSave}
                disabled={profileSaving || !profileName.trim()}
              >
                {profileSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {profileSaving ? 'Saving...' : 'Save changes'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setProfileName(user?.name ?? '')}
                disabled={profileSaving || profileName === (user?.name ?? '')}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-1 border-t pt-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Member since</dt>
            <dd>{formatDateTime(user?.created_at)}</dd>
          </div>
        </dl>
      </section>

      {/* Password */}
      <section className="space-y-5">
        <header>
          <h2 className="text-base font-semibold">Password</h2>
          <p className="text-sm text-muted-foreground">
            Change your password and decide whether to keep other sessions
            alive.
          </p>
        </header>

        <form className="space-y-4" onSubmit={handlePasswordSave}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
          </div>

          <label
            htmlFor="revoke-other-sessions"
            className="flex items-start gap-3 text-sm"
          >
            <Checkbox
              id="revoke-other-sessions"
              checked={revokeAfterPasswordChange}
              onCheckedChange={(checked) =>
                setRevokeAfterPasswordChange(checked === true)
              }
            />
            <span className="space-y-0.5">
              <span className="block">
                Sign out other sessions after changing password
              </span>
              <span className="block text-muted-foreground">
                Useful when you have stale browser sessions open on other
                devices.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              type="submit"
              disabled={
                passwordSaving ||
                currentPassword.length === 0 ||
                newPassword.length < 8
              }
            >
              {passwordSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              {passwordSaving ? 'Updating...' : 'Update password'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Use at least 8 characters.
            </p>
          </div>
        </form>
      </section>

      {/* Sessions */}
      <section className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Sessions</h2>
            <p className="text-sm text-muted-foreground">
              Review where you are signed in and close anything you don't
              trust.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshSessionState()}
              disabled={sessionsPending || sessionPending}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevokeOtherSessions}
              disabled={revokingOtherSessions || otherSessions.length === 0}
            >
              {revokingOtherSessions ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Sign out others
            </Button>
          </div>
        </header>

        <ul className="divide-y">
          <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {describeUserAgent(authSessionData?.session?.userAgent)}
                </span>
                <Badge variant="secondary">This device</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Signed in {formatDateTime(authSessionData?.session?.createdAt)}
                {' · '}
                Expires{' '}
                {formatRelativeTime(authSessionData?.session?.expiresAt)}
                {' · '}
                {authSessionData?.session?.ipAddress ?? 'Unavailable'}
              </div>
            </div>
          </li>

          {sessionsPending ? (
            <li className="py-3 text-sm text-muted-foreground">
              Loading sessions...
            </li>
          ) : otherSessions.length === 0 ? null : (
            otherSessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-sm font-medium">
                    {describeUserAgent(session.userAgent)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last active {formatRelativeTime(session.updatedAt)}
                    {' · '}
                    Expires {formatRelativeTime(session.expiresAt)}
                    {' · '}
                    {session.ipAddress ?? 'Unavailable IP'}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRevokeSession(session.token)}
                  disabled={revokingToken === session.token}
                >
                  {revokingToken === session.token ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                  Sign out
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            {signingOut ? 'Signing out...' : 'Sign out of this device'}
          </Button>
        </div>
      </section>
    </div>
  )
}
