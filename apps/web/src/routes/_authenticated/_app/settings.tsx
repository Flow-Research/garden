import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SettingsPageShell } from '@/features/settings/components/settings-page-shell'

export const Route = createFileRoute('/_authenticated/_app/settings')({
  head: () => ({ meta: [{ title: 'All settings | Garden' }] }),
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <SettingsPageShell>
      <Outlet />
    </SettingsPageShell>
  )
}
