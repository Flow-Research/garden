import { useState } from 'react'
import { Result } from 'better-result'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LogOut,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { timeAgo } from '@garden/core/format'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import { useNavigationActions } from '@/features/navigation'
import { authClient } from '@/lib/auth/client'
import { authClientOperation } from '@/lib/auth/client-result'
import { accountSessionsQueryOptions } from '../account-queries'
import {
  describeSessionDevice,
  type SessionDeviceKind,
} from '../session-device'
import { SettingsPanel } from './settings-page-shell'

const deviceIcons: Record<SessionDeviceKind, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
}

const columns = [
  'Operating system',
  'Application',
  'IP address',
  'Last active',
  'Status',
]

type SignOutTarget =
  | { kind: 'session'; token: string; device: string }
  | { kind: 'others' }
  | { kind: 'current' }

function signOutConfirmCopy(target: SignOutTarget) {
  switch (target.kind) {
    case 'session':
      return {
        title: 'Sign out this session?',
        description: `${target.device} will need to sign in again.`,
        confirmLabel: 'Sign out',
      }
    case 'others':
      return {
        title: 'Log out of other sessions?',
        description:
          'Every device except this one will be signed out and need to sign in again.',
        confirmLabel: 'Log out others',
      }
    case 'current':
      return {
        title: 'Sign out of this device?',
        description: 'You will need to sign in again to use Garden here.',
        confirmLabel: 'Sign out',
      }
  }
}

/** Active sign-in sessions with per-session and bulk sign-out, each confirmed first. */
export function LoginSessions() {
  const queryClient = useQueryClient()
  const { replace } = useNavigationActions()
  const authLogout = useAuthStore((s) => s.logout)
  const { data: authSession, refetch: refetchAuthSession } =
    authClient.useSession()
  const sessionsQuery = useQuery(accountSessionsQueryOptions())
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Kept after close so the dialog copy does not blank out while it animates.
  const [confirmTarget, setConfirmTarget] = useState<SignOutTarget>({
    kind: 'current',
  })

  const currentSessionId = authSession?.session?.id ?? null
  const sessions = [...(sessionsQuery.data ?? [])].sort((a, b) =>
    a.id === currentSessionId
      ? -1
      : b.id === currentSessionId
        ? 1
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
  const hasOtherSessions = sessions.some((s) => s.id !== currentSessionId)

  const refreshSessions = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: accountSessionsQueryOptions().queryKey,
      }),
      refetchAuthSession(),
    ])

  const askToSignOut = (target: SignOutTarget) => {
    setConfirmTarget(target)
    setConfirmOpen(true)
  }

  // Each action rejects on failure so ConfirmDialog stays open for a retry.
  const revokeOthers = async () =>
    (
      await authClientOperation({
        fallbackMessage: 'Failed to sign out other sessions',
        operation: 'revoke-other-sessions',
        request: () => authClient.revokeOtherSessions(),
      })
    ).match({
      ok: async () => {
        await refreshSessions()
        toast.success('Other sessions signed out')
      },
      err: (error) => {
        toast.error(error.message)
        return Promise.reject(error)
      },
    })

  const revokeSession = async (token: string) =>
    (
      await authClientOperation({
        fallbackMessage: 'Failed to sign out session',
        operation: 'revoke-session',
        request: () => authClient.revokeSession({ token }),
      })
    ).match({
      ok: async () => {
        await refreshSessions()
        toast.success('Session signed out')
      },
      err: (error) => {
        toast.error(error.message)
        return Promise.reject(error)
      },
    })

  const signOutCurrent = async () =>
    (
      await Result.tryPromise({
        try: () => authLogout(),
        catch: (cause) =>
          cause instanceof Error ? cause.message : 'Failed to sign out',
      })
    ).match({
      ok: () => {
        queryClient.clear()
        useWorkspaceStore.getState().clearWorkspace()
        toast.success('Signed out')
        replace('/login')
      },
      err: (message) => {
        toast.error(message)
        return Promise.reject(new Error(message))
      },
    })

  const confirmCopy = signOutConfirmCopy(confirmTarget)

  return (
    <SettingsPanel className="overflow-hidden p-0 sm:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6">
        <div className="max-w-xl space-y-1">
          <h2 className="text-sm font-semibold">Login sessions</h2>
          <p className="text-sm text-muted-foreground">
            Devices currently signed in to your account. If you see one you
            don't recognize, sign it out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh sessions"
            onClick={() => void refreshSessions()}
            disabled={sessionsQuery.isFetching}
          >
            <RefreshCw
              aria-hidden="true"
              className={sessionsQuery.isFetching ? 'animate-spin' : undefined}
            />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => askToSignOut({ kind: 'others' })}
            disabled={!hasOtherSessions}
          >
            Log out of other sessions
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-background-main-secondary">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-4 py-3 text-center font-medium"
                >
                  {column}
                </th>
              ))}
              <th scope="col" className="w-12 px-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sessionsQuery.isPending ? (
              <SessionSkeletonRows />
            ) : sessionsQuery.isError ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <span className="text-destructive">
                      {sessionsQuery.error.message}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void sessionsQuery.refetch()}
                    >
                      <RefreshCw aria-hidden="true" className="size-4" />
                      Retry
                    </Button>
                  </div>
                </td>
              </tr>
            ) : (
              sessions.map((session) => {
                const device = describeSessionDevice(session.userAgent)
                const DeviceIcon = deviceIcons[device.kind]
                const isCurrent = session.id === currentSessionId
                return (
                  <tr key={session.id} className="text-center">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <DeviceIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground"
                        />
                        {device.operatingSystem}
                      </span>
                    </td>
                    <td className="px-4 py-3">{device.application}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {session.ipAddress || 'Unavailable'}
                    </td>
                    <td className="px-4 py-3">{timeAgo(session.updatedAt)}</td>
                    <td className="px-4 py-3">
                      {isCurrent ? (
                        <Badge className="bg-success/10 text-success">
                          This device
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Active</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      {isCurrent ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Sign out ${device.application} on ${device.operatingSystem}`}
                          onClick={() =>
                            askToSignOut({
                              kind: 'session',
                              token: session.token,
                              device: `${device.application} on ${device.operatingSystem}`,
                            })
                          }
                        >
                          <LogOut aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="border-t p-4 sm:px-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => askToSignOut({ kind: 'current' })}
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out of this device
        </Button>
      </footer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        pendingLabel="Signing out..."
        tone="destructive"
        onConfirm={() =>
          confirmTarget.kind === 'session'
            ? revokeSession(confirmTarget.token)
            : confirmTarget.kind === 'others'
              ? revokeOthers()
              : signOutCurrent()
        }
      />
    </SettingsPanel>
  )
}

function SessionSkeletonRows() {
  return [0, 1].map((row) => (
    <tr key={row}>
      {columns.map((column) => (
        <td key={column} className="px-4 py-4">
          <Skeleton className="mx-auto h-4 w-20" />
        </td>
      ))}
      <td />
    </tr>
  ))
}
