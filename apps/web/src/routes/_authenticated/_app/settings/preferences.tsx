import { createFileRoute } from '@tanstack/react-router'
import { AppearanceTab } from '@/features/settings/components/appearance-tab'
import { SettingsPanel } from '@/features/settings/components/settings-page-shell'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/preferences',
)({
  component: AppearanceTabSection,
})

function AppearanceTabSection() {
  return (
    <SettingsPanel>
      <AppearanceTab />
    </SettingsPanel>
  )
}
