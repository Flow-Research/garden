import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceTab } from '@/features/settings/components/workspace-tab'

export const Route = createFileRoute('/_authenticated/_app/settings/general')({
  component: WorkspaceTab,
})
