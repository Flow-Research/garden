import { Button } from '@garden/ui/components/ui/button'
import { InboxComposeDialog } from './inbox-compose-dialog'

export function InboxFooter({
  composeOpen,
  onComposeOpenChange,
  draftId,
  onNewEmail,
}: {
  composeOpen: boolean
  onComposeOpenChange: (open: boolean) => void
  draftId: string | null
  onNewEmail: () => void
}) {
  return (
    <>
      <Button className="w-full cursor-pointer py-5" onClick={onNewEmail}>
        + Start Email
      </Button>
      <InboxComposeDialog
        open={composeOpen}
        onOpenChange={onComposeOpenChange}
        draftId={draftId}
      />
    </>
  )
}
