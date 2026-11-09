import { createFileRoute } from '@tanstack/react-router'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import {
  computeInboxItems,
  reconcileInboxItems,
} from '@/lib/server/inbox-compute'
import { requireWorkspaceContext } from '@/lib/server/control-plane'

export const getInbox = async ({
  context,
}: {
  context: AppRequestContext
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext, {
    missingWorkspaceResponse: () => Response.json([]),
  })
  if (workspaceContext instanceof Response) return workspaceContext
  const { session, workspaceId } = workspaceContext

  await reconcileInboxItems({
    workspaceId,
    userId: session.user.id,
  }).catch((error: unknown) => {
    console.error('[inbox] reconcile failed', error)
  })
  const items = await computeInboxItems({
    db: await appContext.db(),
    workspaceId,
    userId: session.user.id,
  })
  return Response.json(items)
}

export const Route = createFileRoute('/api/inbox')({
  server: {
    handlers: {
      GET: getInbox,
    },
  },
})
