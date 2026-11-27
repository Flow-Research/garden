import { createFileRoute } from '@tanstack/react-router'
import { InboxPage } from '@/features/inbox'
import { inboxListOptions } from '@/lib/inbox/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/inbox')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      inboxListOptions(workspaceId),
    ]),
  component: InboxRoute,
})

function InboxRoute() {
  return <InboxPage />
}
