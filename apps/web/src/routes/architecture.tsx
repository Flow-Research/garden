import { createFileRoute } from '@tanstack/react-router'
import { ArchitecturePage } from '@/features/architecture'

const ARCHITECTURE_TITLE = 'Architecture — Garden'
const ARCHITECTURE_DESCRIPTION =
  'Garden’s agent runtime architecture and the reasoning behind it — durable execution, the actor model, run lifecycles, and why a bare agent harness is the wrong shape for a multi-tenant product.'

export const Route = createFileRoute('/architecture')({
  head: () => ({
    meta: [
      { title: ARCHITECTURE_TITLE },
      { name: 'description', content: ARCHITECTURE_DESCRIPTION },
      { property: 'og:title', content: ARCHITECTURE_TITLE },
      { property: 'og:description', content: ARCHITECTURE_DESCRIPTION },
      { name: 'twitter:title', content: ARCHITECTURE_TITLE },
      { name: 'twitter:description', content: ARCHITECTURE_DESCRIPTION },
    ],
  }),
  component: ArchitecturePage,
})
