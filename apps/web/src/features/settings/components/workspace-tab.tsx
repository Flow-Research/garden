'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Input } from '@garden/ui/components/ui/input'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { Label } from '@garden/ui/components/ui/label'
import { Button } from '@garden/ui/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@garden/ui/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'
import {
  useLeaveWorkspace,
  useDeleteWorkspace,
} from '@garden/core/workspace/mutations'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  memberListOptions,
  workspaceKeys,
} from '@garden/core/workspace/queries'
import { api } from '@garden/core/api'
import type { Workspace } from '@garden/core/types'

export function WorkspaceTab() {
  const user = useAuthStore((s) => s.user)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const wsId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(wsId))
  const qc = useQueryClient()
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)
  const leaveWorkspace = useLeaveWorkspace()
  const deleteWorkspace = useDeleteWorkspace()

  const [name, setName] = useState(workspace?.name ?? '')
  const [description, setDescription] = useState(workspace?.description ?? '')
  const [context, setContext] = useState(workspace?.context ?? '')
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    variant?: 'destructive'
    onConfirm: () => Promise<void>
  } | null>(null)

  const currentMember = members.find((m) => m.user_id === user?.id) ?? null
  const canManageWorkspace =
    currentMember?.role === 'owner' || currentMember?.role === 'admin'
  const isOwner = currentMember?.role === 'owner'

  useEffect(() => {
    setName(workspace?.name ?? '')
    setDescription(workspace?.description ?? '')
    setContext(workspace?.context ?? '')
  }, [workspace])

  const handleSave = async () => {
    if (!workspace) return
    setSaving(true)
    try {
      const updated = await api.updateWorkspace(workspace.id, {
        name,
        description,
        context,
      })
      updateWorkspace(updated)
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      )
      toast.success('Workspace settings saved')
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to save workspace settings',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleLeaveWorkspace = () => {
    if (!workspace) return
    setConfirmAction({
      title: 'Leave workspace',
      description: `Leave ${workspace.name}? You will lose access until re-invited.`,
      variant: 'destructive',
      onConfirm: async () => {
        setActionId('leave')
        try {
          await leaveWorkspace.mutateAsync(workspace.id)
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : 'Failed to leave workspace',
          )
        } finally {
          setActionId(null)
        }
      },
    })
  }

  const handleDeleteWorkspace = () => {
    if (!workspace) return
    setConfirmAction({
      title: 'Delete workspace',
      description: `Delete ${workspace.name}? This cannot be undone. All issues, agents, and data will be permanently removed.`,
      variant: 'destructive',
      onConfirm: async () => {
        setActionId('delete-workspace')
        try {
          await deleteWorkspace.mutateAsync(workspace.id)
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : 'Failed to delete workspace',
          )
        } finally {
          setActionId(null)
        }
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
              onChange={(e) => setName(e.target.value)}
              disabled={!canManageWorkspace}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              onChange={(e) => setContext(e.target.value)}
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
              <Save className="h-3 w-3" />
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
            Leaving or deleting is immediate and can't be undone.
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

          {isOwner && (
            <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">
                  Delete workspace
                </p>
                <p className="text-xs text-muted-foreground">
                  Permanently delete this workspace and its data.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteWorkspace}
                disabled={actionId === 'delete-workspace'}
              >
                {actionId === 'delete-workspace'
                  ? 'Deleting...'
                  : 'Delete workspace'}
              </Button>
            </li>
          )}
        </ul>
      </section>

      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(v) => {
          if (!v) setConfirmAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmAction?.variant === 'destructive'
                  ? 'destructive'
                  : 'default'
              }
              onClick={async () => {
                await confirmAction?.onConfirm()
                setConfirmAction(null)
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
