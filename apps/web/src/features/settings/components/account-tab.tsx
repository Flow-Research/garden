'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera,
  Clock3,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Shield,
} from 'lucide-react'
import { Input } from '@accelerate/ui/components/ui/input'
import { Label } from '@accelerate/ui/components/ui/label'
import { Button } from '@accelerate/ui/components/ui/button'
import { Badge } from '@accelerate/ui/components/ui/badge'
import { Checkbox } from '@accelerate/ui/components/ui/checkbox'
import { Separator } from '@accelerate/ui/components/ui/separator'
import { toast } from 'sonner'
import { useAuthStore } from '@accelerate/core/auth'
import { api } from '@accelerate/core/api'
import { useFileUpload } from '@accelerate/core/hooks/use-file-upload'
import { useWorkspaceStore } from '@accelerate/core/workspace'
import { useNavigation } from '@/features/navigation'
import { authClient } from '@/lib/auth-client'

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
    <div className="space-y-6">
      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Account</h2>
              <Badge
                variant={
                  authSessionData?.user?.emailVerified ? 'secondary' : 'outline'
                }
              >
                {authSessionData?.user?.emailVerified
                  ? 'Email verified'
                  : 'Email not verified'}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Update your profile and keep the current browser session in view.
            </p>
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:w-[24rem]">
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em]">
                <Mail className="size-3.5" />
                <span>Email</span>
              </div>
              <div className="mt-1 truncate text-foreground">
                {user?.email ?? 'Unavailable'}
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em]">
                <Clock3 className="size-3.5" />
                <span>Joined</span>
              </div>
              <div className="mt-1 text-foreground">
                {formatDateTime(user?.created_at)}
              </div>
            </div>
          </div>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-6 lg:grid-cols-[96px_minmax(0,1fr)]">
          <div className="space-y-2">
            <button
              type="button"
              className="group relative flex size-24 items-center justify-center overflow-hidden rounded-full border bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <span className="text-2xl font-semibold text-muted-foreground">
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
            <p className="text-xs text-muted-foreground">PNG, JPG, or GIF.</p>
          </div>

          <div className="space-y-4">
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

            <div className="flex flex-wrap items-center gap-3">
              <Button
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
                variant="outline"
                onClick={() => setProfileName(user?.name ?? '')}
                disabled={profileSaving || profileName === (user?.name ?? '')}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-background p-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Security</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Change your password and decide whether to keep other sessions
            alive.
          </p>
        </div>

        <Separator className="my-5" />

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

          <div className="flex items-start gap-3 rounded-md border bg-muted/20 px-3 py-3">
            <Checkbox
              id="revoke-other-sessions"
              checked={revokeAfterPasswordChange}
              onCheckedChange={(checked) =>
                setRevokeAfterPasswordChange(checked === true)
              }
            />
            <div className="space-y-1">
              <Label htmlFor="revoke-other-sessions">
                Sign out other sessions after changing password
              </Label>
              <p className="text-sm text-muted-foreground">
                Useful when you have stale browser sessions open on other
                devices.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
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
            <p className="text-sm text-muted-foreground">
              Use at least 8 characters.
            </p>
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Sessions</h2>
            <p className="text-sm text-muted-foreground">
              Review where you are signed in and close anything you do not
              trust.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
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
              Sign out other sessions
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              {signingOut ? 'Signing out...' : 'Sign out'}
            </Button>
          </div>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Current</Badge>
              <span className="text-sm font-medium">
                {describeUserAgent(authSessionData?.session?.userAgent)}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Signed in</dt>
                <dd className="mt-1 text-foreground">
                  {formatDateTime(authSessionData?.session?.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="mt-1 text-foreground">
                  {formatRelativeTime(authSessionData?.session?.expiresAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">IP address</dt>
                <dd className="mt-1 text-foreground">
                  {authSessionData?.session?.ipAddress ?? 'Unavailable'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Other active sessions</div>
                <div className="text-sm text-muted-foreground">
                  {otherSessions.length === 0
                    ? 'No other active sessions.'
                    : `${otherSessions.length} session${otherSessions.length === 1 ? '' : 's'} active.`}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {sessionsPending ? (
                <div className="text-sm text-muted-foreground">
                  Loading sessions...
                </div>
              ) : otherSessions.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  You only have the current browser session open.
                </div>
              ) : (
                otherSessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-md border bg-background px-3 py-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="truncate text-sm font-medium">
                          {describeUserAgent(session.userAgent)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Last active {formatRelativeTime(session.updatedAt)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {session.ipAddress ?? 'Unavailable IP'} · Expires{' '}
                          {formatRelativeTime(session.expiresAt)}
                        </div>
                      </div>

                      <Button
                        variant="outline"
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
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
