import { createFileRoute } from '@tanstack/react-router'
import {
  BrainFolderDetailResponseSchema,
  BrainFolderResponseSchema,
  BrainFolderUpdateInputSchema,
} from '@/features/brain/contract'
import {
  brainFileSummaryOf,
  loadBrainFileOwnerNames,
  loadBrainItemsByIds,
} from '@/lib/server/brain-file-summary'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import {
  badRequest,
  notFound,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import {
  brainFolderSummaryOf,
  deleteBrainFolder,
  getBrainFolder,
  listBrainFolderFileIds,
  updateBrainFolder,
} from '@/lib/server/brain-folders'

/**
 * Folder detail for the folder view: Garden-owned folder row plus member
 * files resolved through Brain by id (loadBrainItemsByIds — filtering the
 * capped listFiles dropped members past 100 files). Stale members whose
 * files were deleted drop out silently.
 */
export const getBrainFolderDetail = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const folder = await getBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: params.id,
  })
  if (folder === null) return notFound('Folder not found')

  const memberIds = await listBrainFolderFileIds({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    folderId: params.id,
  })

  const resolved = await loadBrainItemsByIds({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    fileIds: memberIds,
  })
  if (resolved.status === 'unconfigured') {
    return badRequest('Brain is not configured (missing HELIX_URL)')
  }
  if (resolved.status === 'unavailable') {
    return Response.json(
      { error: 'Brain files are unavailable' },
      { status: 503 },
    )
  }

  const ownerNames = await loadBrainFileOwnerNames({
    env: appContext.env,
    items: resolved.items,
  })
  const files = resolved.items.map((item) =>
    brainFileSummaryOf(item, ownerNames),
  )

  const body = BrainFolderDetailResponseSchema.parse({
    item: brainFolderSummaryOf({ ...folder, fileCount: files.length }),
    files,
  })

  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Applies rename/privacy updates from the folder card menu. */
export const patchBrainFolder = async ({
  context,
  params,
  request,
}: {
  context: AppRequestContext
  params: { id: string }
  request: Request
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  // Malformed/empty bodies must 400, not escape as a 500 SyntaxError.
  const inputResult = BrainFolderUpdateInputSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!inputResult.success) {
    return badRequest(
      inputResult.error.issues[0]?.message ?? 'Invalid folder input',
    )
  }

  const updated = await updateBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: params.id,
    name: inputResult.data.name,
    privacy: inputResult.data.privacy,
  })
  if (!updated) return notFound('Folder not found')

  const row = await getBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: params.id,
  })
  if (row === null) return notFound('Folder not found')

  const body = BrainFolderResponseSchema.parse({
    item: brainFolderSummaryOf(row),
  })

  return Response.json(body)
}

/** Deletes a folder; member files themselves stay in the knowledge base. */
export const deleteBrainFolderHandler = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const deleted = await deleteBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: params.id,
  })
  if (!deleted) return notFound('Folder not found')

  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/api/brain/folders/$id')({
  server: {
    handlers: {
      GET: getBrainFolderDetail,
      PATCH: patchBrainFolder,
      DELETE: deleteBrainFolderHandler,
    },
  },
})
