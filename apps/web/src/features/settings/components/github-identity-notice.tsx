import { CircleAlert, CircleCheck } from 'lucide-react'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import { useSettingsDialogStore } from '@/features/settings/settings-dialog-store'

export type GithubIdentityOutcome = 'linked' | 'taken' | 'failed'

const COPY: Record<GithubIdentityOutcome, { title: string; body: string }> = {
  linked: {
    title: 'GitHub linked',
    body: 'Agents can now assign GitHub issues to you.',
  },
  taken: {
    title: 'GitHub account already linked',
    body: 'That GitHub account is linked to another member of this workspace. Ask an owner or admin to unlink it first.',
  },
  failed: {
    title: 'GitHub link failed',
    body: 'GitHub did not finish the sign-in. Try again from Settings.',
  },
}

/**
 * Outcome of "Link with GitHub", shown where `/api/github/identity/complete`
 * lands the member (Home, `?github_identity=`). Settings is a store-driven
 * dialog with no URL, so the redirect cannot reopen it directly; this notice
 * reports the result and offers the way back. Dismiss strips the param so a
 * reload does not replay it.
 */
export function GithubIdentityNotice({
  outcome,
  onDismiss,
}: {
  outcome: GithubIdentityOutcome
  onDismiss: () => void
}) {
  const openSettings = useSettingsDialogStore((state) => state.openSettings)
  const copy = COPY[outcome]
  const failed = outcome !== 'linked'

  return (
    <Alert
      variant={failed ? 'destructive' : 'default'}
      className="mx-8 mt-4 w-auto"
    >
      {failed ? (
        <CircleAlert className="size-4" />
      ) : (
        <CircleCheck className="size-4" />
      )}
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.body}</AlertDescription>
      <AlertAction className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            openSettings('profile')
            onDismiss()
          }}
        >
          Open settings
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  )
}
