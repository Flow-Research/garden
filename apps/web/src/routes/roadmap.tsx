import { createFileRoute } from '@tanstack/react-router'
import { RoadmapPage, roadmapViews, pilotWeekIds } from '@/features/roadmap'
import type { RoadmapView, PilotWeekId } from '@/features/roadmap'

const ROADMAP_TITLE = 'Roadmap — Garden'
const ROADMAP_DESCRIPTION =
  'Where Garden stands on the road to beta — readiness gates, launch blockers, connector trust work, the pilot weekly plan, and what we are deliberately not building yet.'

/**
 * /roadmap keeps its UI state (active view + selected pilot week) in search
 * params so every state is a shareable URL and SSR renders exactly what the
 * client hydrates — no hash-sniffing, no effects.
 */
export const Route = createFileRoute('/roadmap')({
  validateSearch: (search: Record<string, unknown>) => {
    const view = roadmapViews.includes(search.view as RoadmapView)
      ? (search.view as RoadmapView)
      : undefined
    const week = pilotWeekIds.includes(search.week as PilotWeekId)
      ? (search.week as PilotWeekId)
      : undefined
    return {
      ...(view ? { view } : {}),
      ...(week ? { week } : {}),
    }
  },
  head: () => ({
    meta: [
      { title: ROADMAP_TITLE },
      { name: 'description', content: ROADMAP_DESCRIPTION },
      { property: 'og:title', content: ROADMAP_TITLE },
      { property: 'og:description', content: ROADMAP_DESCRIPTION },
      { name: 'twitter:title', content: ROADMAP_TITLE },
      { name: 'twitter:description', content: ROADMAP_DESCRIPTION },
    ],
  }),
  component: RoadmapPage,
})
