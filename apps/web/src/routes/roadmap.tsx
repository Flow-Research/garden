import { createFileRoute } from '@tanstack/react-router'
import { RoadmapPage } from '@/features/roadmap'

const ROADMAP_TITLE = 'Roadmap — Garden'
const ROADMAP_DESCRIPTION =
  'Where Garden stands on the road to beta — readiness gates, launch blockers, connector trust work, the pilot weekly plan, and what we are deliberately not building yet.'

export const Route = createFileRoute('/roadmap')({
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
