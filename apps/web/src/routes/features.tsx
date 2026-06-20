import { createFileRoute } from '@tanstack/react-router'
import { FeaturesPage } from '@/features/marketing'

const FEATURES_TITLE = 'Features — Garden'
const FEATURES_DESCRIPTION =
  'Product reference for Garden surfaces — why each exists, what it helps teams do, and how it is triggered.'

export const Route = createFileRoute('/features')({
  head: () => ({
    meta: [
      { title: FEATURES_TITLE },
      { name: 'description', content: FEATURES_DESCRIPTION },
      { property: 'og:title', content: FEATURES_TITLE },
      { property: 'og:description', content: FEATURES_DESCRIPTION },
      { name: 'twitter:title', content: FEATURES_TITLE },
      { name: 'twitter:description', content: FEATURES_DESCRIPTION },
    ],
  }),
  component: FeaturesPage,
})
