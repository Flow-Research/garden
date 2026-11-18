import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { Result, TaggedError } from 'better-result'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { MemberRole } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useFileUpload } from '@garden/app-state/hooks/use-file-upload'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { cn } from '@garden/ui/lib/utils'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { hasPasswordSignInMethod } from '@/lib/auth/sign-in-methods'
import { memberListOptions } from '@/lib/workspace/queries'
import {
  accountSessionsQueryOptions,
  linkedAccountsQueryOptions,
} from '../account-queries'
import { ChangePasswordDialog } from './change-password-dialog'
import { GithubWorkspaceIdentitySection } from './github-workspace-identity'
import { GoogleAccountConnection } from './google-account-connection'
import { LoginSessions } from './login-sessions'
import { SettingsPanel } from './settings-page-shell'

class ProfileUpdateError extends TaggedError('ProfileUpdateError')<{
  cause: unknown
  message: string
}>() {}

/** Runs a profile write and turns any rejection into a typed error. */
function profileUpdate<T>(fallbackMessage: string, request: () => Promise<T>) {
  return Result.tryPromise({
    try: request,
    catch: (cause) =>
      new ProfileUpdateError({
        cause,
        message: cause instanceof Error ? cause.message : fallbackMessage,
      }),
  })
}

const roleLabels: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

/** Routed Profile section: identity, sign-in methods and active sessions. */
export function ProfileSettings() {
  return (
    <div className="space-y-4">
      <IdentityCard />
      <SignInCard />
      <SettingsPanel className="space-y-10">
        <GithubWorkspaceIdentitySection />
        <GoogleAccountConnection />
      </SettingsPanel>
      <LoginSessions />
    </div>
  )
}

function IdentityCard() {
  const user = useAuthStore((s) => s.user)
  const wsId = useWorkspaceId()
  const { data: members } = useQuery(memberListOptions(wsId))
  const role = members?.find((member) => member.user_id === user?.id)?.role

  return (
    <SettingsPanel className="relative flex items-center gap-4 sm:gap-6">
      <AvatarUpload />
      <div className="min-w-0 flex-1 space-y-1">
        {/* Right padding clears the corner Edit name button on phones. */}
        <div className="flex flex-wrap items-center gap-2 pr-10 sm:pr-0">
          <h2 className="line-clamp-2 text-base leading-snug font-semibold break-words sm:text-lg">
            {user?.name || user?.email}
          </h2>
          {role ? (
            <Badge className="bg-info/10 text-info">{roleLabels[role]}</Badge>
          ) : null}
        </div>
        {user?.created_at ? (
          <p className="text-xs text-muted-foreground sm:text-sm">
            Member since {format(new Date(user.created_at), 'MMM d, yyyy')}
          </p>
        ) : null}
      </div>
      <EditNameDialog />
    </SettingsPanel>
  )
}

function EditNameDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-3 right-3 px-2 sm:static sm:px-3"
        onClick={() => setOpen(true)}
      >
        <Pencil aria-hidden="true" className="size-4" />
        <span className="sr-only sm:not-sr-only">Edit name</span>
      </Button>
      <DialogContent size="md" className="gap-6 p-6">
        {/* The popup unmounts on close, so each open starts from the saved name. */}
        <EditNameForm
          onCancel={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditNameForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void
  onSaved: () => void
}) {
  const savedName = useAuthStore((s) => s.user?.name ?? '')
  const setUser = useAuthStore((s) => s.setUser)
  const [name, setName] = useState(savedName)
  const [saving, setSaving] = useState(false)
  const trimmed = name.trim()
  const canSave = !saving && trimmed.length > 0 && trimmed !== savedName

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    const result = await profileUpdate('Failed to update name', () =>
      api.updateMe({ name: trimmed }),
    )
    result.match({
      ok: (updated) => {
        setUser(updated)
        toast.success('Name updated')
        onSaved()
      },
      err: (error) => {
        setSaving(false)
        toast.error(error.message)
      },
    })
  }

  return (
    <form className="space-y-6" onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">Edit name</DialogTitle>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="preferred-name">Preferred name</Label>
        <Input
          id="preferred-name"
          className="h-10 bg-muted"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          autoComplete="name"
          required
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {saving ? <Spinner aria-hidden="true" /> : null}
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function AvatarUpload() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const { upload, uploading } = useFileUpload(api)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initials = (user?.name || user?.email || '')
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const result = await profileUpdate('Failed to upload avatar', async () => {
      const uploaded = await upload(file)
      return uploaded ? api.updateMe({ avatar_url: uploaded.link }) : null
    })
    result.match({
      ok: (updated) => {
        if (!updated) return
        setUser(updated)
        toast.success('Avatar updated')
      },
      err: (error) => toast.error(error.message),
    })
  }

  return (
    <>
      <button
        type="button"
        className="group relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-info/15 text-base font-semibold text-info sm:size-16 sm:text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        aria-label={uploading ? 'Uploading avatar' : 'Change avatar'}
        aria-busy={uploading || undefined}
      >
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          initials
        )}
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
            uploading ? 'opacity-100' : 'opacity-0',
          )}
        >
          {uploading ? (
            <Spinner className="size-5 text-white" aria-hidden="true" />
          ) : (
            <Camera className="size-5 text-white" aria-hidden="true" />
          )}
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </>
  )
}

function SignInCard() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const { data: authSession, refetch: refetchAuthSession } =
    authClient.useSession()
  const { data: linkedAccounts } = useQuery(linkedAccountsQueryOptions())
  // Hidden until accounts load: Google-only users have no password to change.
  const hasPassword =
    linkedAccounts?.match({
      ok: (response) => hasPasswordSignInMethod(response.data ?? []),
      err: () => false,
    }) ?? false
  const emailVerified = authSession?.user?.emailVerified === true

  const handlePasswordChanged = () => {
    void queryClient.invalidateQueries({
      queryKey: accountSessionsQueryOptions().queryKey,
    })
    void refetchAuthSession()
  }

  return (
    <SettingsPanel className="divide-y py-0 sm:py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4 sm:py-5">
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold">Email</h2>
          <p className="truncate text-sm text-muted-foreground">
            {user?.email}
          </p>
        </div>
        <Badge variant={emailVerified ? 'secondary' : 'outline'}>
          {emailVerified ? 'Verified' : 'Not verified'}
        </Badge>
      </div>
      {hasPassword ? (
        <div className="flex flex-wrap items-center justify-between gap-3 py-4 sm:py-5">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">Password</h2>
            <p className="text-sm text-muted-foreground">
              Change the password you use to sign in.
            </p>
          </div>
          <ChangePasswordDialog onChanged={handlePasswordChanged} />
        </div>
      ) : null}
    </SettingsPanel>
  )
}
