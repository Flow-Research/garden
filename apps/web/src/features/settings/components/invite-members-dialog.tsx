import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Result } from 'better-result'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { MemberRole } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import { api } from '@/lib/api'
import { workspaceKeys } from '@/lib/workspace/queries'
import { TeamMultiPicker } from '@/features/teams/components/team-picker'

type InviteRole = Exclude<MemberRole, 'owner'>

type InviteRow = {
  key: number
  email: string
  role: InviteRole
  teamIds: string[]
  error: string | null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Field chrome shared with the Create Team dialog. */
const FIELD_CLASS =
  'h-10 border-[0.5px] border-border-default bg-background-main-secondary shadow-none placeholder:text-text-tertiary'

const blankRow = (key: number): InviteRow => ({
  key,
  email: '',
  role: 'member',
  teamIds: [],
  error: null,
})

/**
 * Checks every filled row before anything is sent, so one typo never leaves
 * half the batch invited. Returns the rows with their inline errors set.
 */
function validateRows(rows: InviteRow[]) {
  const seen = new Set<string>()
  return rows.map((row) => {
    const email = row.email.trim().toLowerCase()
    if (!email) return { ...row, error: null }
    if (!EMAIL_PATTERN.test(email)) {
      return { ...row, error: 'Enter a valid email address' }
    }
    if (seen.has(email)) return { ...row, error: 'Already in this list' }
    seen.add(email)
    return { ...row, error: null }
  })
}

/**
 * Add a Team Member dialog: one row per invitee with email, workspace role
 * and the Teams they join on accept. Each row is its own invitation request;
 * rows that fail stay in the dialog with the server's message while the rest
 * are cleared, so a retry only resends what failed.
 */
export function InviteMembersDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const nextKey = useRef(2)
  const [rows, setRows] = useState<InviteRow[]>(() => [
    blankRow(0),
    blankRow(1),
  ])
  const [sending, setSending] = useState(false)
  // Enter in a field submits the form; the ref blocks a second submit before
  // the disabled state renders.
  const sendingRef = useRef(false)

  const filledCount = rows.filter((row) => row.email.trim()).length

  const updateRow = (key: number, patch: Partial<InviteRow>) => {
    if (sendingRef.current) return
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, ...patch, error: null } : row,
      ),
    )
  }

  const addRow = () => {
    const key = nextKey.current++
    setRows((current) => [...current, blankRow(key)])
  }

  const removeRow = (key: number) =>
    setRows((current) => current.filter((row) => row.key !== key))

  const send = async () => {
    if (sendingRef.current) return
    const checked = validateRows(rows)
    const filled = checked.filter((row) => row.email.trim())
    if (filled.length === 0) return
    if (filled.some((row) => row.error)) {
      setRows(checked)
      return
    }

    sendingRef.current = true
    setSending(true)
    const outcomes = await Promise.all(
      filled.map(async (row) => ({
        row,
        result: await Result.tryPromise({
          try: () =>
            api.createMember(workspaceId, {
              email: row.email.trim(),
              role: row.role,
              ...(row.teamIds.length ? { team_ids: row.teamIds } : {}),
            }),
          catch: (cause) =>
            cause instanceof Error
              ? cause.message
              : 'Failed to send invitation',
        }),
      })),
    )
    sendingRef.current = false
    setSending(false)

    const failed = outcomes.flatMap(({ row, result }) =>
      result.isErr() ? [{ ...row, error: result.error }] : [],
    )
    const sentCount = outcomes.length - failed.length
    if (sentCount > 0) {
      void qc.invalidateQueries({
        queryKey: workspaceKeys.invitations(workspaceId),
      })
      toast.success(
        sentCount === 1 ? 'Invitation sent' : `${sentCount} invitations sent`,
      )
    }
    if (failed.length === 0) {
      onClose()
      return
    }
    setRows(failed)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="xl"
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-4 sm:max-h-[calc(100dvh-2rem)] sm:p-8"
      >
        <div className="flex justify-end">
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>
        <DialogTitle className="mt-1 text-center text-lg leading-tight font-semibold sm:text-xl">
          Add a Team Member
        </DialogTitle>
        <DialogDescription className="mt-2 text-center text-sm text-balance text-text-secondary">
          We&apos;ll send a link to this team member to join Garden
        </DialogDescription>

        <form
          className="mt-5 flex min-h-0 flex-col sm:mt-10"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain px-1">
            <span className="text-sm">Team Member</span>
            <ul className="mt-2 flex flex-col gap-3">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="flex flex-col gap-1 rounded-lg border border-border-default p-2 sm:rounded-none sm:border-0 sm:p-0"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Input
                      aria-invalid={row.error ? true : undefined}
                      aria-label={`Invitee ${index + 1} email`}
                      className={FIELD_CLASS}
                      disabled={sending}
                      onChange={(event) =>
                        updateRow(row.key, { email: event.target.value })
                      }
                      placeholder="Enter email"
                      type="email"
                      value={row.email}
                      wrapperClassName="col-span-2 min-w-0 sm:col-span-1"
                    />
                    <Select
                      disabled={sending}
                      value={row.role}
                      onValueChange={(value) =>
                        updateRow(row.key, { role: value as InviteRole })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Invitee ${index + 1} role`}
                        className={`h-10! w-full min-w-0 ${FIELD_CLASS}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <TeamMultiPicker
                      teamIds={row.teamIds}
                      onUpdate={(teamIds) => updateRow(row.key, { teamIds })}
                      triggerRender={
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`Teams invitee ${index + 1} joins`}
                          className={`col-span-2 w-full min-w-0 justify-start gap-1.5 overflow-hidden sm:col-span-1 ${FIELD_CLASS}`}
                          disabled={sending}
                        />
                      }
                    />
                    <Button
                      aria-label={`Remove invitee ${index + 1}`}
                      className="col-start-3 row-start-1 size-10 sm:col-start-4"
                      disabled={sending || rows.length === 1}
                      onClick={() => removeRow(row.key)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  {row.error ? (
                    <p
                      role="alert"
                      className="text-xs text-text-danger-default"
                    >
                      {row.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button
              className="mt-3 px-2 text-text-brand-default"
              disabled={sending}
              onClick={addRow}
              type="button"
              variant="ghost"
            >
              <Plus className="size-4" />
              Add a team member
            </Button>
          </div>

          <div className="mt-4 grid shrink-0 grid-cols-2 gap-2 sm:mt-6">
            <Button
              className="h-10"
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="h-10"
              disabled={sending || filledCount === 0}
              type="submit"
            >
              {sending
                ? 'Sending…'
                : filledCount > 1
                  ? `Send ${filledCount} invites`
                  : 'Send invite'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The Add a Team Member button with its dialog. It owns the open state so
 * opening the dialog re-renders only this button, not the member table.
 */
export function InviteMembersButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        className="ml-auto h-10 rounded-md px-3"
        onClick={() => setOpen(true)}
      >
        Add a Team Member
      </Button>
      {open ? (
        <InviteMembersDialog
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
