import { useState } from 'react'
import { Result } from 'better-result'
import { Save } from 'lucide-react'
import { Input } from '@garden/ui/components/ui/input'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { Label } from '@garden/ui/components/ui/label'
import { Button } from '@garden/ui/components/ui/button'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useLeaveWorkspace } from '@/lib/workspace/mutations'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { memberListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { api } from '@/lib/api'
import type { Workspace } from '@garden/core/types'

export function WorkspaceTab() {
  const user = useAuthStore((s) => s.user)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const wsId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(wsId))
  const qc = useQueryClient()
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)
  const leaveWorkspace = useLeaveWorkspace()

  // Unsaved edits, tied to the workspace they were made in. Copying the
  // workspace into state with an effect reset the fields on every workspace
  // store update, wiping what was being typed.
  type Drafts = Partial<Record<'name' | 'description' | 'context', string>>
  const [draftState, setDraftState] = useState<{
    workspaceId: string | null
    drafts: Drafts
  }>({ workspaceId: null, drafts: {} })
  const drafts =
    draftState.workspaceId === (workspace?.id ?? null) ? draftState.drafts : {}
  const setDraft = (field: keyof Drafts, value: string) =>
    setDraftState({
      workspaceId: workspace?.id ?? null,
      drafts: { ...drafts, [field]: value },
    })
  const name = drafts.name ?? workspace?.name ?? ''
  const description = drafts.description ?? workspace?.description ?? ''
  const context = drafts.context ?? workspace?.context ?? ''
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    confirmLabel: string
    pendingLabel: string
    variant?: 'destructive'
    onConfirm: () => Promise<void>
  } | null>(null)

  const currentMember = members.find((m) => m.user_id === user?.id) ?? null
  const canManageWorkspace =
    currentMember?.role === 'owner' || currentMember?.role === 'admin'
  const handleSave = async () => {
    if (!workspace) return
    setSaving(true)
    const result = await Result.tryPromise({
      try: async () =>
        await api.updateWorkspace(workspace.id, {
          name,
          description,
          context,
        }),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    })
    if (result.isOk()) {
      const updated = result.value
      updateWorkspace(updated)
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      )
      setDraftState({ workspaceId: null, drafts: {} })
      toast.success('Workspace settings saved')
    } else {
      toast.error(result.error.message)
    }
    setSaving(false)
  }

  const handleLeaveWorkspace = () => {
    if (!workspace || !currentMember) return
    setConfirmAction({
      title: 'Leave workspace',
      description: `Leave ${workspace.name}? You will lose access until re-invited.`,
      confirmLabel: 'Leave',
      pendingLabel: 'Leaving…',
      variant: 'destructive',
      onConfirm: () => {
        setActionId('leave')
        return Result.tryPromise({
          try: async () =>
            await leaveWorkspace.mutateAsync({ workspaceId: workspace.id }),
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        })
          .then((result) => {
            if (result.isErr()) {
              toast.error(result.error.message)
              throw result.error
            }
          })
          .finally(() => setActionId(null))
      },
    })
  }

  if (!workspace) return null

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <header>
          <h2 className="text-base font-semibold">General</h2>
          <p className="text-sm text-muted-foreground">
            How this workspace shows up and how agents see its context.
          </p>
        </header>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setDraft('name', e.target.value)}
              disabled={!canManageWorkspace}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDraft('description', e.target.value)}
              rows={3}
              disabled={!canManageWorkspace}
              className="resize-none"
              placeholder="What does this workspace focus on?"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Context</Label>
            <Textarea
              value={context}
              onChange={(e) => setDraft('context', e.target.value)}
              rows={4}
              disabled={!canManageWorkspace}
              className="resize-none"
              placeholder="Background for AI agents working in this workspace"
            />
          </div>
          <dl className="grid gap-x-6 gap-y-1 border-t pt-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono text-xs">{workspace.slug}</dd>
            </div>
          </dl>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !name.trim() || !canManageWorkspace}
            >
              <Save className="size-3" />
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
            {!canManageWorkspace && (
              <p className="text-xs text-muted-foreground">
                Only admins and owners can update workspace settings.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <header>
          <h2 className="text-base font-semibold">Danger zone</h2>
          <p className="text-sm text-muted-foreground">
            Leaving is immediate. Rejoin with a fresh invitation.
          </p>
        </header>

        <ul className="divide-y border-t">
          <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Leave workspace</p>
              <p className="text-xs text-muted-foreground">
                Remove yourself from this workspace.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLeaveWorkspace}
              disabled={actionId === 'leave'}
            >
              {actionId === 'leave' ? 'Leaving...' : 'Leave workspace'}
            </Button>
          </li>
        </ul>
      </section>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        title={confirmAction?.title}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
        pendingLabel={confirmAction?.pendingLabel}
        tone={
          confirmAction?.variant === 'destructive' ? 'destructive' : 'default'
        }
        onConfirm={() =>
          confirmAction ? confirmAction.onConfirm() : Promise.resolve()
        }
      />
    </div>
  )
}
