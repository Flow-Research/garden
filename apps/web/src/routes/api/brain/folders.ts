import { createFileRoute } from '@tanstack/react-router'
import {
  BrainFolderCreateInputSchema,
  BrainFolderListResponseSchema,
  BrainFolderResponseSchema,
} from '@/features/brain/contract'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import { badRequest, requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  brainFolderSummaryOf,
  createBrainFolder,
  getBrainFolder,
  listBrainFolders,
} from '@/lib/server/brain-folders'

/**
 * Lists the active workspace's folders (Penpot "Folders" section, newest
 * first). Folder rows are Garden-owned Postgres records; see
 * `@/lib/server/brain-folders` for why they do not live in Helix.
 */
export const getBrainFolders = async ({
  context,
}: {
  context: AppRequestContext
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const rows = await listBrainFolders({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
  })

  const body = BrainFolderListResponseSchema.parse({
    items: rows.map(brainFolderSummaryOf),
  })

  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Creates a folder from the create-folder dialog (name ≤ 50 chars, privacy). */
export const postBrainFolder = async ({
  context,
  request,
}: {
  context: AppRequestContext
  request: Request
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  // Malformed/empty bodies must 400, not escape as a 500 SyntaxError.
  const inputResult = BrainFolderCreateInputSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!inputResult.success) {
    return badRequest(
      inputResult.error.issues[0]?.message ?? 'Invalid folder input',
    )
  }

  const created = await createBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    name: inputResult.data.name,
    privacy: inputResult.data.privacy,
  })

  const row = await getBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: created.id,
  })
  if (row === null) {
    return Response.json({ error: 'Folder could not be read' }, { status: 500 })
  }

  const body = BrainFolderResponseSchema.parse({
    item: brainFolderSummaryOf(row),
  })

  return Response.json(body, { status: 201 })
}

export const Route = createFileRoute('/api/brain/folders')({
  server: {
    handlers: {
      GET: getBrainFolders,
      POST: postBrainFolder,
    },
  },
})
