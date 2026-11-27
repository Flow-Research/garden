import { createFileRoute } from '@tanstack/react-router'
import { IssuesPage } from '@/features/issues/components'
import {
  childIssueProgressOptions,
  issueListOptions,
} from '@/lib/issues/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/tasks/')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      issueListOptions(workspaceId),
      childIssueProgressOptions(workspaceId),
    ]),
  component: TasksIndexRoute,
})

function TasksIndexRoute() {
  return <IssuesPage />
}
