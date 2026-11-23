import { createFileRoute } from '@tanstack/react-router'
import { AccountTab } from '@/features/settings/components/account-tab'

export const Route = createFileRoute('/_authenticated/_app/settings/profile')({
  component: AccountTab,
})
