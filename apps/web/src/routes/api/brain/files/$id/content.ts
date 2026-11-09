import { Effect, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { buildContentDisposition } from '@garden/agent-runtime'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { formatOf, type FileFormat } from '@garden/brain/services/extractor'
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

const CONTENT_TYPES: Record<FileFormat, string> = {
  markdown: 'text/plain; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
}

/** Returns fixed response metadata from the validated file extension. */
function responseMetadataFor(filename: string): {
  contentType: string
  inlineSafe: boolean
} {
  const format = formatOf(filename)
  if (format === null) {
    return { contentType: 'application/octet-stream', inlineSafe: false }
  }

  return {
    contentType: CONTENT_TYPES[format],
    inlineSafe:
      format === 'text' ||
      format === 'markdown' ||
      format === 'csv' ||
      format === 'pdf',
  }
}

/**
 * Streams a private Brain file after Brain verifies that the item belongs to
 * the active workspace. The R2 key stays on the server. The response streams
 * the object body so the Worker does not buffer a file of up to 100 MB.
 *
 * Cloudflare R2 reference:
 * https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 */
export const getBrainFileContent = async ({
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

  const download = new URL(request.url).searchParams.has('download')
  const metadata = responseMetadataFor(item.label)
  const headers = new Headers()

  headers.set('Content-Type', metadata.contentType)
  headers.set(
    'Content-Disposition',
    buildContentDisposition(
      download || !metadata.inlineSafe ? 'attachment' : 'inline',
      item.label,
    ),
  )
  headers.set('ETag', object.httpEtag)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')

  return new Response(object.body, { headers })
}

export const Route = createFileRoute('/api/brain/files/$id/content')({
  server: {
    handlers: {
      GET: getBrainFileContent,
    },
  },
})
