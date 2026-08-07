import { useState } from 'react'
import { FolderKanban, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { UpdateIssueRequest } from '@garden/core/types'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { projectListOptions } from '@/lib/projects/queries'
import {
  PickerEmpty,
  PickerItem,
  PropertyPicker,
} from '../../issues/components/pickers/property-picker'

/** Selects an issue project from the warm workspace project query. */
export function ProjectPicker({
  projectId,
  onUpdate,
  triggerRender,
  align = 'start',
}: {
  projectId: string | null
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  triggerRender?: React.ReactElement
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const workspaceId = useWorkspaceId()
  const { data: projects = [] } = useQuery(projectListOptions(workspaceId))
  const current = projects.find((project) => project.id === projectId)

  const choose = (nextProjectId: string | null) => {
    onUpdate({ project_id: nextProjectId })
    setOpen(false)
  }

  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      align={align}
      width="w-52"
      triggerRender={triggerRender}
      trigger={
        <>
          <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{current?.title ?? 'No project'}</span>
        </>
      }
    >
      {projects.map((project) => (
        <PickerItem
          key={project.id}
          selected={project.id === projectId}
          onClick={() => choose(project.id)}
        >
          <span>{project.icon || '📁'}</span>
          <span className="truncate">{project.title}</span>
        </PickerItem>
      ))}
      {projectId ? (
        <PickerItem selected={false} onClick={() => choose(null)}>
          <X className="size-3.5 text-muted-foreground" />
          Remove from project
        </PickerItem>
      ) : null}
      {!projects.length ? <PickerEmpty /> : null}
    </PropertyPicker>
  )
}
