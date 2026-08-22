import { Effect, Option, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import {
  ExecutorToolPreviewRequest,
  ExecutorToolPreviewResponse,
} from '@/lib/executor-contract'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  CatalogProviderNotFoundError,
  catalogCandidateSource,
  getExecutorCatalogSurfaces,
  getExecutorProvider,
} from '@/lib/server/executor-engine/catalog'
import { IntegrationsShDomainSurface } from '@/lib/server/executor-engine/integrations-sh'
import { previewProviderTools } from '@/lib/server/executor-engine/tool-preview'
import { logApiFailure } from '@/lib/server/api-logging'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'

class ExecutorPreviewRouteError extends Schema.Error<ExecutorPreviewRouteError>(
  'ExecutorPreviewRouteError',
)({
  status: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const previewResponse = Effect.fn('ExecutorPreview.response')(function* (
  request: Request,
) {
  const payload = yield* Effect.mapError(
    Effect.tryPromise(() => request.json()),
    (cause) =>
      new ExecutorPreviewRouteError({
        status: 400,
        message: 'Preview request must contain valid JSON.',
        cause,
      }),
  )
  const input = yield* Effect.mapError(
    Schema.decodeUnknownEffect(ExecutorToolPreviewRequest)(payload),
    (cause) =>
      new ExecutorPreviewRouteError({
        status: 400,
        message: 'Preview request must contain a valid provider and source.',
        cause,
      }),
  )
  const provider = yield* Effect.mapError(
    getExecutorProvider(input.providerId),
    (failure) =>
      new ExecutorPreviewRouteError({
        status: failure instanceof CatalogProviderNotFoundError ? 404 : 502,
        message:
          failure instanceof CatalogProviderNotFoundError
            ? 'Provider was not found in the integration catalog.'
            : 'Integration catalog is unavailable.',
        cause: failure,
      }),
  )
  const selectedCandidates = provider.candidates.filter(
    (candidate) => catalogCandidateSource(candidate) === input.source,
  )
  if (selectedCandidates.length === 0) {
    return yield* new ExecutorPreviewRouteError({
      status: 404,
      message: 'Provider does not publish the selected source.',
    })
  }

  let surface = IntegrationsShDomainSurface.make({
    domain: String(provider.domain),
    description: Option.none(),
    summary: Option.none(),
    surfaces: [],
  })
  if (
    selectedCandidates.some(
      (candidate) => candidate.kind === 'mcp' || candidate.kind === 'openapi',
    )
  ) {
    const discovered = yield* Effect.match(
      getExecutorCatalogSurfaces(selectedCandidates),
      {
        onFailure: (error) => {
          logApiFailure({
            request,
            event: 'executor.preview.discovery_degraded',
            error,
            level: 'warn',
          })
          return Option.none<IntegrationsShDomainSurface>()
        },
        onSuccess: Option.some,
      },
    )
    if (Option.isSome(discovered)) surface = discovered.value
  }
  return yield* previewProviderTools(provider, surface, input.source)
})

export const Route = createFileRoute('/api/executor/preview')({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const outcome = await runExecutorRouteEffect({
          effect: previewResponse(request),
          request,
          event: 'executor.preview.failed',
          fallbackMessage: 'Integration preview is unavailable.',
        })
        if (!outcome.ok) return outcome.response
        return Response.json(
          Schema.encodeSync(ExecutorToolPreviewResponse)(outcome.value),
        )
      },
    },
  },
})
