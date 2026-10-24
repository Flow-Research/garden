import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateIssueRequest } from '@garden/core/types'
import { useIssueSelectionStore } from '@garden/app-state/issues/stores/selection-store'
import { useSurfaceTabsStore } from '@garden/app-state/surface-tabs'
import { Button } from '@garden/ui/components/ui/button'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import {
  useBatchDeleteIssues,
  useBatchUpdateIssues,
} from '@/lib/issues/mutations'
import { AssigneePicker, PriorityPicker, StatusPicker } from './pickers'

type OpenControl = 'status' | 'priority' | 'assignee' | 'delete' | null

/** Floating command bar for mutations over the current issue selection. */
export function BatchActionToolbar() {
  const selectedIds = useIssueSelectionStore((state) => state.selectedIds)
  const clearSelection = useIssueSelectionStore((state) => state.clear)
  const [openControl, setOpenControl] = useState<OpenControl>(null)
  const updateIssues = useBatchUpdateIssues()
  const deleteIssues = useBatchDeleteIssues()
  const count = selectedIds.size

  if (!count) return null

  const ids = [...selectedIds]
  const pending = updateIssues.isPending || deleteIssues.isPending
  const update = (updates: Partial<UpdateIssueRequest>) => {
    updateIssues.mutate(
      { ids, updates },
      {
        onSuccess: () =>
          toast.success(`Updated ${count} issue${count === 1 ? '' : 's'}`),
        onError: () => toast.error('Failed to update issues'),
      },
    )
  }
  const remove = async () => {
    try {
      await deleteIssues.mutateAsync(ids)
    } catch (error) {
      toast.error('Failed to delete issues')
      throw error
    }
    // Close their tabs — persisted tabs would route to 404ing detail queries.
    const { closeTab } = useSurfaceTabsStore.getState()
    for (const id of ids) closeTab('tasks', id)
    clearSelection()
    toast.success(`Deleted ${count} issue${count === 1 ? '' : 's'}`)
  }

  const pickerButton = <Button variant="ghost" size="sm" disabled={pending} />

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background px-2 py-1.5 shadow-lg">
        <div className="mr-1 flex items-center gap-1.5 border-r pl-1 pr-2">
          <span className="text-sm font-medium">{count} selected</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={clearSelection}
            aria-label="Clear selection"
          >
            <X />
          </Button>
        </div>
        <StatusPicker
          status="todo"
          onUpdate={update}
          open={openControl === 'status'}
          onOpenChange={(open) => setOpenControl(open ? 'status' : null)}
          triggerRender={pickerButton}
          trigger="Status"
          align="center"
        />
        <PriorityPicker
          priority="none"
          onUpdate={update}
          open={openControl === 'priority'}
          onOpenChange={(open) => setOpenControl(open ? 'priority' : null)}
          triggerRender={pickerButton}
          trigger="Priority"
          align="center"
        />
        <AssigneePicker
          assigneeType={null}
          assigneeId={null}
          onUpdate={update}
          open={openControl === 'assignee'}
          onOpenChange={(open) => setOpenControl(open ? 'assignee' : null)}
          triggerRender={pickerButton}
          trigger="Assignee"
          align="center"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="text-destructive hover:text-destructive"
          onClick={() => setOpenControl('delete')}
        >
          <Trash2 />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={openControl === 'delete'}
        onOpenChange={(open) => setOpenControl(open ? 'delete' : null)}
        title={`Delete ${count} issue${count === 1 ? '' : 's'}?`}
        description={`This permanently deletes the selected issue${count === 1 ? '' : 's'} and associated data.`}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        tone="destructive"
        onConfirm={remove}
      />
    </>
  )
}
