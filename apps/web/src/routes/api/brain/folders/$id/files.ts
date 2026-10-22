import { Effect, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import {
  BrainFolderDetailResponseSchema,
  BrainFolderFileInputSchema,
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
  addBrainFolderFile,
  brainFolderSummaryOf,
  getBrainFolder,
  listBrainFolderFileIds,
  removeBrainFolderFile,
} from '@/lib/server/brain-folders'

type FolderFilesArgs = {
  context: AppRequestContext
  params: { id: string }
}

async function requireFolder(args: FolderFilesArgs) {
  const appContext = requireAppRequestContext(args.context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const folder = await getBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: args.params.id,
  })
  if (folder === null) return notFound('Folder not found')

  return { appContext, workspaceContext, folder }
}

/**
 * Reads the workspace's real Brain files and returns the folder detail body.
 * Shared by add/remove so both mutations answer with the authoritative
 * post-change state (mirrors the GET detail handler).
 */
async function folderDetailResponse({
  appContext,
  workspaceContext,
  folder,
}: {
  appContext: AppRequestContext
  workspaceContext: { workspaceId: string; session: { user: { id: string } } }
  folder: { id: string }
}): Promise<Response> {
  const memberIds = await listBrainFolderFileIds({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    folderId: folder.id,
  })
  const fullFolder = await getBrainFolder({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.session.user.id,
    folderId: folder.id,
  })
  if (fullFolder === null) return notFound('Folder not found')

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
    item: brainFolderSummaryOf({ ...fullFolder, fileCount: files.length }),
    files,
  })

  return Response.json(body)
}

/**
 * Adds a workspace brain file to a folder ("Add to folder" card menu). The
 * file id is verified against Helix first so folders cannot point at foreign
 * or non-file brain items.
 */
export const postBrainFolderFile = async ({
  context,
  params,
  request,
}: FolderFilesArgs & { request: Request }): Promise<Response> => {
  const resolved = await requireFolder({ context, params })
  if (resolved instanceof Response) return resolved
  const { appContext, workspaceContext, folder } = resolved

  // Malformed/empty bodies must 400, not escape as a 500 SyntaxError.
  const inputResult = BrainFolderFileInputSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!inputResult.success) return badRequest('Invalid file id')

  const env = appContext.env
  const helixUrl = env.HELIX_URL
  if (helixUrl === undefined) {
    return badRequest('Brain is not configured (missing HELIX_URL)')
  }

  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: env.HELIX_API_KEY,
    ai: env.AI,
    files: env.BRAIN_FILES,
  })
  const readResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        brain.readFileItem(
          ItemId.make(inputResult.data.fileId),
          WorkspaceId.make(workspaceContext.workspaceId),
        ),
      ).pipe(Effect.provide(brainLive)),
    ),
  )
  if (EffectResult.isFailure(readResult)) {
    return Response.json(
      { error: 'Brain files are unavailable' },
      { status: 503 },
    )
  }
  if (readResult.success === null) return notFound('Brain file not found')

  await addBrainFolderFile({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    folderId: folder.id,
    fileId: inputResult.data.fileId,
    userId: workspaceContext.session.user.id,
  })

  return folderDetailResponse({ appContext, workspaceContext, folder })
}

/** Removes a file from a folder; the file itself stays in the knowledge base. */
export const deleteBrainFolderFile = async ({
  context,
  params,
  request,
}: FolderFilesArgs & { request: Request }): Promise<Response> => {
  const resolved = await requireFolder({ context, params })
  if (resolved instanceof Response) return resolved
  const { appContext, workspaceContext, folder } = resolved

  // Malformed/empty bodies must 400, not escape as a 500 SyntaxError.
  const inputResult = BrainFolderFileInputSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!inputResult.success) return badRequest('Invalid file id')

  const removed = await removeBrainFolderFile({
    env: appContext.env,
    workspaceId: workspaceContext.workspaceId,
    folderId: folder.id,
    fileId: inputResult.data.fileId,
  })
  if (!removed) return notFound('File is not in this folder')

  return folderDetailResponse({ appContext, workspaceContext, folder })
}

export const Route = createFileRoute('/api/brain/folders/$id/files')({
  server: {
    handlers: {
      POST: postBrainFolderFile,
      DELETE: deleteBrainFolderFile,
    },
  },
})
