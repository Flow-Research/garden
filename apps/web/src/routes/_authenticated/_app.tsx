import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/shell/app-shell'

/**
 * Pathless layout wrapping every surface route in the redesigned shell
 * (sidebar + top bar). Routes that must render shell-free (e.g. the invitation
 * acceptance page) stay directly under `_authenticated`, outside `_app`.
 */
export const Route = createFileRoute('/_authenticated/_app')({
  component: AppShell,
})
