import { Effect, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { buildContentDisposition, markdownToDocx } from '@garden/agent-runtime'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { formatOf } from '@garden/brain/services/extractor'
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

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * "Download as Word" for a Markdown file in Files & Folders (#381). Files
 * store Markdown as the source of truth, so Word is rendered here on each
 * request from the current bytes and never stored. Access matches the
 * content route: Brain verifies the item belongs to the active workspace.
 */
export const getBrainFileDocx = async ({
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
      { error: 'Brain file content is unavailable' },
      { status: 503 },
    )
  }

  const item = readResult.success
  if (item === null) return notFound('Brain file not found')

  const r2Key = item.r2Key
  if (r2Key === undefined) return notFound('Brain file content not found')

  const objectResult = await Effect.runPromise(
    Effect.result(
      Effect.tryPromise<R2ObjectBody | null>(() => env.BRAIN_FILES.get(r2Key)),
    ),
  )

  if (EffectResult.isFailure(objectResult)) {
    return Response.json(
      { error: 'Brain file content is unavailable' },
      { status: 503 },
    )
  }

  const object = objectResult.success
  if (object === null) return notFound('Brain file content not found')

  if (formatOf(item.label) !== 'markdown') {
    return badRequest('Only Markdown files can be downloaded as Word')
  }
  const markdown = await object.text()
  const title = item.label.replace(/\.(md|markdown)$/i, '')
  const bytes = await markdownToDocx({ title, markdown })

  const headers = new Headers()
  headers.set('Content-Type', DOCX_CONTENT_TYPE)
  headers.set(
    'Content-Disposition',
    buildContentDisposition('attachment', `${title}.docx`),
  )
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(bytes, { headers })
}

export const Route = createFileRoute('/api/brain/files/$id/docx')({
  server: {
    handlers: {
      GET: getBrainFileDocx,
    },
  },
})
