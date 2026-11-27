import { Effect, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { BrainFileIdSchema } from '@/features/brain/contract'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import {
  badRequest,
  notFound,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'

/**
 * Returns the extracted text for a Brain file in the active workspace.
 * The response does not expose the R2 key or other internal Brain fields.
 */
export const getBrainFileExtractedText = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext
  const itemIdResult = BrainFileIdSchema.safeParse(params.id)
  if (!itemIdResult.success) return badRequest('Invalid Brain file id')

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
          ItemId.make(itemIdResult.data),
          WorkspaceId.make(workspaceContext.workspaceId),
        ),
      ).pipe(Effect.provide(brainLive)),
    ),
  )

  if (EffectResult.isFailure(readResult)) {
    return Response.json(
      { error: 'Brain file text is unavailable' },
      { status: 503 },
    )
  }

  const item = readResult.success

  if (item === null) {
    return notFound('Brain file not found')
  }

  if (item.body === undefined) {
    return notFound('Brain file text not found')
  }

  return new Response(item.body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export const Route = createFileRoute('/api/brain/files/$id/text')({
  server: {
    handlers: {
      GET: getBrainFileExtractedText,
    },
  },
})
