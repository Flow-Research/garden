import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceTab } from '@/features/settings/components/workspace-tab'
import { SettingsPanel } from '@/features/settings/components/settings-page-shell'

export const Route = createFileRoute('/_authenticated/_app/settings/general')({
  component: WorkspaceTabSection,
})

function WorkspaceTabSection() {
  return (
    <SettingsPanel>
      <WorkspaceTab />
    </SettingsPanel>
  )
}
