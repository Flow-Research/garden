import { createFileRoute } from '@tanstack/react-router'
import { GeneralSettings } from '@/features/settings/components/general-settings'

export const Route = createFileRoute('/_authenticated/_app/settings/general')({
  component: GeneralSettings,
})
