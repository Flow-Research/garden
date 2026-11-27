import { Outlet, createFileRoute } from '@tanstack/react-router'

/** Workflows surface layout — parent of workflows.index + workflows.$id. */
export const Route = createFileRoute('/_authenticated/_app/workflows')({
  component: Outlet,
})
