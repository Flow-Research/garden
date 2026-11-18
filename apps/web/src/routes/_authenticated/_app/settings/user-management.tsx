import { createFileRoute } from '@tanstack/react-router'
import { MembersTab } from '@/features/settings/components/members-tab'
import { SettingsPanel } from '@/features/settings/components/settings-page-shell'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management',
)({
  component: MembersTabSection,
})

function MembersTabSection() {
  return (
    <SettingsPanel>
      <MembersTab />
    </SettingsPanel>
  )
}
