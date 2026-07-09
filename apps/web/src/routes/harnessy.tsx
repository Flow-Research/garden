import { createFileRoute } from '@tanstack/react-router'
import { HarnessyPage } from '@/features/marketing'

const HARNESSY_TITLE = 'Harnessy — Garden'
const HARNESSY_DESCRIPTION =
  'Where Garden is going: the hosted enterprise surface over the open Harnessy context engine and Pi runtime, and the Jarvis orchestration layer coming next.'

export const Route = createFileRoute('/harnessy')({
  head: () => ({
    meta: [
      { title: HARNESSY_TITLE },
      { name: 'description', content: HARNESSY_DESCRIPTION },
      { property: 'og:title', content: HARNESSY_TITLE },
      { property: 'og:description', content: HARNESSY_DESCRIPTION },
      { name: 'twitter:title', content: HARNESSY_TITLE },
      { name: 'twitter:description', content: HARNESSY_DESCRIPTION },
    ],
  }),
  component: HarnessyPage,
})
