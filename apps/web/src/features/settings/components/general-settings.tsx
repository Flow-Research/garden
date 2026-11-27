import { useState } from 'react'
import { Result, TaggedError } from 'better-result'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import type { Workspace } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { api } from '@/lib/api'
import { useLeaveWorkspace } from '@/lib/workspace/mutations'
import { memberListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { SettingsPanel } from './settings-page-shell'

class WorkspaceSettingsError extends TaggedError('WorkspaceSettingsError')<{
  cause: unknown
  message: string
}>() {}

/** Runs a workspace write and turns any rejection into a typed error. */
function workspaceRequest<T>(
  fallbackMessage: string,
  request: () => Promise<T>,
) {
  return Result.tryPromise({
    try: request,
    catch: (cause) =>
      new WorkspaceSettingsError({
        cause,
        message: cause instanceof Error ? cause.message : fallbackMessage,
      }),
  })
}

type Field = 'name' | 'description' | 'context'
type Drafts = Partial<Record<Field, string>>

/** Routed General section: workspace details and leaving the workspace. */
export function GeneralSettings() {
  const user = useAuthStore((s) => s.user)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const wsId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(wsId))
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null
  const canManage =
    currentMember?.role === 'owner' || currentMember?.role === 'admin'

  if (!workspace) return null

  return (
    <div className="space-y-4">
      <WorkspaceDetailsCard workspace={workspace} canManage={canManage} />
      <DangerZoneCard workspace={workspace} isMember={!!currentMember} />
    </div>
  )
}

function WorkspaceDetailsCard({
  workspace,
  canManage,
}: {
  workspace: Workspace
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)
  // Drafts are tied to the workspace they were typed in, so switching
  // workspaces never carries unsaved text across.
  const [draftState, setDraftState] = useState<{
    workspaceId: string | null
    drafts: Drafts
  }>({ workspaceId: null, drafts: {} })
  const [saving, setSaving] = useState(false)
  const drafts =
    draftState.workspaceId === workspace.id ? draftState.drafts : {}
  const saved: Record<Field, string> = {
    name: workspace.name,
    description: workspace.description ?? '',
    context: workspace.context ?? '',
  }
  const values: Record<Field, string> = {
    name: drafts.name ?? saved.name,
    description: drafts.description ?? saved.description,
    context: drafts.context ?? saved.context,
  }
  const trimmed: Record<Field, string> = {
    name: values.name.trim(),
    description: values.description.trim(),
    context: values.context.trim(),
  }
  const dirty =
    canManage &&
    (Object.keys(saved) as Field[]).some(
      (field) => trimmed[field] !== saved[field].trim(),
    )
  const canSave = dirty && !saving && trimmed.name.length > 0
  const fieldsDisabled = !canManage || saving

  const setDraft = (field: Field, value: string) =>
    setDraftState({
      workspaceId: workspace.id,
      drafts: { ...drafts, [field]: value },
    })
  const resetDrafts = () => setDraftState({ workspaceId: null, drafts: {} })

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    const result = await workspaceRequest(
      'Failed to save workspace settings',
      () => api.updateWorkspace(workspace.id, trimmed),
    )
    result.match({
      ok: (updated) => {
        updateWorkspace(updated)
        queryClient.setQueryData(
          workspaceKeys.list(),
          (old: Workspace[] | undefined) =>
            old?.map((ws) => (ws.id === updated.id ? updated : ws)),
        )
        resetDrafts()
        toast.success('Workspace settings saved')
      },
      err: (error) => toast.error(error.message),
    })
    setSaving(false)
  }

  return (
    <SettingsPanel>
      <form className="space-y-6" onSubmit={handleSave}>
        <header className="space-y-1">
          <h2 className="text-base font-semibold">General</h2>
          <p className="text-sm text-muted-foreground">
            How this workspace shows up and how agents see its context.
          </p>
        </header>

        {!canManage ? (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Lock aria-hidden="true" className="size-4 shrink-0" />
            Only admins and owners can edit workspace settings.
          </p>
        ) : null}

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={values.name}
              onChange={(event) => setDraft('name', event.target.value)}
              disabled={fieldsDisabled}
              aria-invalid={
                dirty && trimmed.name.length === 0 ? true : undefined
              }
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workspace-description">Description</Label>
            <Textarea
              id="workspace-description"
              value={values.description}
              onChange={(event) => setDraft('description', event.target.value)}
              rows={3}
              disabled={fieldsDisabled}
              className="resize-none"
              placeholder="What does this workspace focus on?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workspace-context">Context</Label>
            <Textarea
              id="workspace-context"
              value={values.context}
              onChange={(event) => setDraft('context', event.target.value)}
              rows={4}
              disabled={fieldsDisabled}
              className="resize-none"
              placeholder="Background for AI agents working in this workspace"
              aria-describedby="workspace-context-hint"
            />
            <p
              id="workspace-context-hint"
              className="text-xs text-muted-foreground"
            >
              Agents read this as background whenever they work in this
              workspace.
            </p>
          </div>
        </div>

        <dl className="flex items-center justify-between gap-4 border-t pt-4 text-sm">
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {workspace.slug}
          </dd>
        </dl>

        {dirty ? (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={resetDrafts}
              disabled={saving}
            >
              Reset
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? <Spinner aria-hidden="true" /> : null}
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        ) : null}
      </form>
    </SettingsPanel>
  )
}

function DangerZoneCard({
  workspace,
  isMember,
}: {
  workspace: Workspace
  isMember: boolean
}) {
  const leaveWorkspace = useLeaveWorkspace()
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Rejects on failure so ConfirmDialog stays open for a retry.
  const leave = async () =>
    (
      await workspaceRequest('Failed to leave workspace', () =>
        leaveWorkspace.mutateAsync({ workspaceId: workspace.id }),
      )
    ).match({
      ok: () => undefined,
      err: (error) => {
        toast.error(error.message)
        return Promise.reject(error)
      },
    })

  return (
    // The gradient layer tints over the card's solid background, so the
    // card stays opaque on the grey container.
    <SettingsPanel className="border-destructive/25 bg-linear-to-b from-destructive/5 to-destructive/5 lg:border dark:border-destructive/40 dark:from-destructive/10 dark:to-destructive/10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold">Danger zone</h2>
          <p className="text-sm text-muted-foreground">
            Leaving is immediate. You lose access to {workspace.name} until
            someone invites you again.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="self-start sm:self-auto"
          onClick={() => setConfirmOpen(true)}
          disabled={!isMember || leaveWorkspace.isPending}
        >
          {leaveWorkspace.isPending ? 'Leaving...' : 'Leave workspace'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Leave workspace"
        description={`Leave ${workspace.name}? You will lose access until re-invited.`}
        confirmLabel="Leave"
        pendingLabel="Leaving…"
        tone="destructive"
        onConfirm={leave}
      />
    </SettingsPanel>
  )
}
