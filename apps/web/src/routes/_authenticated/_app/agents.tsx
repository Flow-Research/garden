import { Outlet, createFileRoute } from '@tanstack/react-router'

/** Agents surface layout — parent of agents.index + agents.$agentId. */
export const Route = createFileRoute('/_authenticated/_app/agents')({
  component: Outlet,
})
