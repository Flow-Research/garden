import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@garden/ui/components/ui/button'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { authClient } from '@/lib/auth/client'
import { authClientOperation } from '@/lib/auth/client-result'

/** Better Auth's default `minPasswordLength`, which Garden does not override. */
const MIN_PASSWORD_LENGTH = 8

/**
 * Opens the change-password form for accounts that sign in with a password.
 * `onChanged` runs after a successful change so callers can refresh sessions
 * the change may have revoked.
 */
export function ChangePasswordDialog({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Change password
      </Button>
      <DialogContent size="md" className="gap-8 p-6 sm:p-8">
        {/* The popup unmounts on close, so typed passwords never persist. */}
        <ChangePasswordForm
          onChanged={() => {
            setOpen(false)
            onChanged()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function ChangePasswordForm({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true)
  const [saving, setSaving] = useState(false)

  const mismatch = confirmation.length > 0 && confirmation !== newPassword
  const canSubmit =
    !saving &&
    currentPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    confirmation === newPassword

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true)

    const result = await authClientOperation({
      fallbackMessage: 'Failed to change password',
      operation: 'change-password',
      request: () =>
        authClient.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions,
        }),
    })

    result.match({
      ok: () => {
        toast.success('Password changed')
        onChanged()
      },
      err: (error) => {
        setSaving(false)
        toast.error(error.message)
      },
    })
  }

  return (
    <>
      <DialogHeader className="items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand">
          <KeyRound aria-hidden="true" className="size-6" />
        </span>
        <DialogTitle className="text-xl font-semibold">
          Change password
        </DialogTitle>
      </DialogHeader>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <PasswordField
          id="current-password"
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          error={mismatch ? 'Passwords do not match' : null}
        />

        <label
          htmlFor="revoke-other-sessions"
          className="flex items-start gap-3 text-sm"
        >
          {/* One line tall, so the box centers on the first line even when
              the label wraps. */}
          <span className="flex h-lh items-center">
            <Checkbox
              id="revoke-other-sessions"
              checked={revokeOtherSessions}
              onCheckedChange={(checked) =>
                setRevokeOtherSessions(checked === true)
              }
            />
          </span>
          <span>Sign out other sessions after changing password</span>
        </label>

        <Button type="submit" className="h-10 w-full" disabled={!canSubmit}>
          {saving ? <Spinner aria-hidden="true" /> : null}
          {saving ? 'Changing password...' : 'Change password'}
        </Button>
      </form>
    </>
  )
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  hint = null,
  error = null,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  minLength?: number
  hint?: string | null
  error?: string | null
}) {
  const [revealed, setRevealed] = useState(false)
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={revealed ? 'text' : 'password'}
          className="h-10 bg-muted pr-10"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          aria-label={
            revealed
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
          className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {revealed ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
