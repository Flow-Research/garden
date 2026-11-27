import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * Tasks surface layout — nests tasks.index (board) and tasks.$issueId
 * (detail). The tab strip lives in the app shell's top bar.
 */
export const Route = createFileRoute('/_authenticated/_app/tasks')({
  component: Outlet,
})
