import { createFileRoute } from '@tanstack/react-router'
import { AppearanceTab } from '@/features/settings/components/appearance-tab'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/preferences',
)({
  component: AppearanceTab,
})
