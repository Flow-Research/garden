import { createFileRoute } from '@tanstack/react-router'
import { ProfileSettings } from '@/features/settings/components/profile-settings'

export const Route = createFileRoute('/_authenticated/_app/settings/profile')({
  component: ProfileSettings,
})
