import { createFileRoute } from '@tanstack/react-router'
import { AppearanceTab } from '@/features/settings/components/appearance-tab'
import { NotificationPreferencesSection } from '@/features/settings/components/notification-preferences-section'
import { SettingsPanel } from '@/features/settings/components/settings-page-shell'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { notificationPreferencesOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/preferences',
)({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      notificationPreferencesOptions(workspaceId),
    ]),
  component: PreferencesSection,
})

function PreferencesSection() {
  return (
    <SettingsPanel className="space-y-12">
      <AppearanceTab />
      <NotificationPreferencesSection />
    </SettingsPanel>
  )
}
