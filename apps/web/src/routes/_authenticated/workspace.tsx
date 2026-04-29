import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceLayout } from '@/components/shell/workspace-layout'

export const Route = createFileRoute('/_authenticated/workspace')({
  component: WorkspaceLayout,
})
