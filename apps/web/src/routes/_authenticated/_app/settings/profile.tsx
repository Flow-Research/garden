import { createFileRoute } from '@tanstack/react-router'
import { AccountTab } from '@/features/settings/components/account-tab'
import { SettingsPanel } from '@/features/settings/components/settings-page-shell'

export const Route = createFileRoute('/_authenticated/_app/settings/profile')({
  component: ProfileSettingsRoute,
})

function ProfileSettingsRoute() {
  return (
    <SettingsPanel>
      <AccountTab />
    </SettingsPanel>
  )
}
