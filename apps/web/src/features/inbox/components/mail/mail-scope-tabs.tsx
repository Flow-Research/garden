// Directly follows Zero's compact inset tab composition. Zero is MIT licensed.
// See THIRD_PARTY_NOTICES.md.

import { Tabs, TabsList, TabsTrigger } from '@garden/ui/components/ui/tabs'
import type { MailScope } from './types'

export function MailScopeTabs({
  value,
  onValueChange,
}: {
  value: MailScope
  onValueChange: (value: MailScope) => void
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as MailScope)}
      className="gap-0"
    >
      <TabsList aria-label="Inbox scope" className="h-7">
        <TabsTrigger value="all" className="px-2 text-xs">
          All
        </TabsTrigger>
        <TabsTrigger value="mail" className="px-2 text-xs">
          Mail
        </TabsTrigger>
        <TabsTrigger value="notifications" className="px-2 text-xs">
          Notifications
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
