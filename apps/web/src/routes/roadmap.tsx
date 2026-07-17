import { createFileRoute } from '@tanstack/react-router'
import { RoadmapPage } from '@/features/roadmap'

const ROADMAP_TITLE = 'Roadmap — Garden'
const ROADMAP_DESCRIPTION =
  'What Garden is building now, what comes next, and what stays out of scope until the core automation loop is reliable.'

/** /roadmap is one chronological page, so it needs no client-side view state. */
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
