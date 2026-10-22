import { createFileRoute } from '@tanstack/react-router'
import { SkillsPage } from '@/features/skills/components'
import { skillListOptions } from '@/lib/workspace/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/skills')({
  // ?focus=<skillId> opens a skill directly (replaces the dock's entityId).
  validateSearch: (search) => {
    const out: { focus?: string } = {}
    if (typeof search.focus === 'string') out.focus = search.focus
    return out
  },
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      skillListOptions(workspaceId),
    ]),
  component: SkillsRoute,
})

function SkillsRoute() {
  const { focus } = Route.useSearch()
  return <SkillsPage focusedSkillId={focus} />
}
