import { createFileRoute, redirect } from '@tanstack/react-router'

/** Back-compat: /automations/$id moved to /workflows/$id in the redesign rename. */
export const Route = createFileRoute('/_authenticated/automations/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workflows/$id',
      params: { id: params.id },
      replace: true,
    })
  },
  component: () => null,
})
