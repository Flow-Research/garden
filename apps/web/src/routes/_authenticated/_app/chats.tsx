import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * Chats surface layout — nests chats.index (composer home) and
 * chats.$threadId. The thread tab strip lives in the app shell's top bar.
 */
export const Route = createFileRoute('/_authenticated/_app/chats')({
  component: Outlet,
})
