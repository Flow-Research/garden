import { createFileRoute } from '@tanstack/react-router'
import { MailDesignPage } from '@/features/mail-design'

export const Route = createFileRoute('/mail-design')({
  head: () => ({
    meta: [
      { title: 'Garden Mail — Design states' },
      {
        name: 'description',
        content: 'Populated visual reference states for Garden Mail.',
      },
    ],
  }),
  component: MailDesignPage,
})
