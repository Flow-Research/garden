import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  NotificationCategory,
  NotificationPreferenceUpdate,
  NotificationPreferenceView,
} from '@garden/db/schema/notification-preferences'
import { Button } from '@garden/ui/components/ui/button'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { Switch } from '@garden/ui/components/ui/switch'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { api } from '@/lib/api'
import {
  notificationPreferencesOptions,
  workspaceKeys,
} from '@/lib/workspace/queries'

const COPY: Record<NotificationCategory, { label: string; hint: string }> = {
  mentions: {
    label: 'Mentions',
    hint: 'Someone mentions you in an issue, a comment, or a chat.',
  },
  assignments: {
    label: 'Assignments',
    hint: 'An issue is assigned to you.',
  },
  approvals: {
    label: 'Approvals',
    hint: 'An agent action, proposal, or work product needs your approval.',
  },
  input_requests: {
    label: 'Input requests',
    hint: 'An agent waits for your answer or needs a connection.',
  },
}

function setChannel(
  view: NotificationPreferenceView | undefined,
  update: NotificationPreferenceUpdate,
): NotificationPreferenceView | undefined {
  return view?.map((row) =>
    row.category === update.category
      ? {
          ...row,
          channels: { ...row.channels, [update.channel]: update.enabled },
        }
      : row,
  )
}

/** Email toggles for the signed-in member in the active workspace. */
export function NotificationPreferencesSection() {
  const wsId = useWorkspaceId()
  const workspaceName = useWorkspaceStore((s) => s.workspace?.name)
  const qc = useQueryClient()
  const options = notificationPreferencesOptions(wsId)
  const { queryKey } = options
  const mutationKey = [...workspaceKeys.notificationPreferences(wsId), 'update']
  const query = useQuery(options)
  const mutation = useMutation({
    mutationKey,
    mutationFn: (update: NotificationPreferenceUpdate) =>
      api.updateNotificationPreference(wsId, update),
    onMutate: async (update) => {
      await qc.cancelQueries({ queryKey })
      qc.setQueryData(queryKey, (view) => setChannel(view, update))
    },
    // Revert only this cell: a snapshot restore would also undo a toggle
    // that another in-flight request saved.
    onError: (_error, update) => {
      qc.setQueryData(queryKey, (view) =>
        setChannel(view, { ...update, enabled: !update.enabled }),
      )
      toast.error(
        `Could not save ${COPY[update.category].label.toLowerCase()} email setting`,
      )
    },
    // Responses can arrive out of order, so reconcile once the last one lands.
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) === 1) {
        void qc.invalidateQueries({ queryKey })
      }
    },
  })

  return (
    <section className="space-y-5" aria-labelledby="notification-email-heading">
      <header className="space-y-1">
        <h2 id="notification-email-heading" className="text-base font-semibold">
          Email notifications
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose which events
          {workspaceName ? ` in ${workspaceName}` : ' in this workspace'} send
          you email. Your inbox in Garden still shows every item.
        </p>
      </header>
      {query.isError ? (
        <div
          className="flex items-center gap-3 border-t pt-5 text-sm"
          role="alert"
        >
          <span>Could not load your notification settings.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <ul className="divide-y border-t" aria-busy={query.isPending}>
          {query.data
            ? query.data.map(({ category, channels }) => {
                const labelId = `notification-${category}-email-label`
                const hintId = `notification-${category}-email-hint`
                return (
                  <li
                    key={category}
                    className="flex items-center justify-between gap-6 py-4"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p id={labelId} className="text-sm font-medium">
                        {COPY[category].label}
                      </p>
                      <p id={hintId} className="text-sm text-muted-foreground">
                        {COPY[category].hint}
                      </p>
                    </div>
                    <Switch
                      aria-labelledby={labelId}
                      aria-describedby={hintId}
                      checked={channels.email}
                      onCheckedChange={(enabled) =>
                        mutation.mutate({ category, channel: 'email', enabled })
                      }
                    />
                  </li>
                )
              })
            : Object.keys(COPY).map((category) => (
                <li key={category} className="py-4">
                  <Skeleton className="h-10 w-full" />
                </li>
              ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Other inbox items, such as new comments, keep sending email.
      </p>
    </section>
  )
}
