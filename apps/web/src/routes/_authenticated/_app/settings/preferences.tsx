import { createFileRoute } from '@tanstack/react-router'
import { PreferencesSettings } from '@/features/settings/components/preferences-settings'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/preferences',
)({
  component: PreferencesSettings,
})
