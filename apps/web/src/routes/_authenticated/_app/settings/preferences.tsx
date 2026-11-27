import { createFileRoute } from '@tanstack/react-router'
import { PreferencesSettings } from '@/features/settings/components/preferences-settings'

import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { notificationPreferencesOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/preferences',
)({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      notificationPreferencesOptions(workspaceId),
    ]),
  component: PreferencesSettings,
})
