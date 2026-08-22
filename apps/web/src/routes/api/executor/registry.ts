import { Effect, Option, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { ExecutorRegistrySearchResponse } from '@/lib/executor-contract'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  getFeaturedExecutorCatalog,
  searchExecutorCatalog,
} from '@/lib/server/executor-engine/catalog'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'

const RegistryQuery = Schema.Struct({
  query: Schema.OptionFromNullishOr(Schema.String),
  category: Schema.OptionFromNullishOr(Schema.String),
  limit: Schema.OptionFromNullishOr(Schema.NumberFromString),
  offset: Schema.OptionFromNullishOr(Schema.NumberFromString),
  featured: Schema.Boolean,
})

class RegistryQueryError extends Schema.Error<RegistryQueryError>(
  'RegistryQueryError',
)({
  status: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Decode query parameters, execute catalog policy, and return the shared
 * registry model as one Effect program. */
const registryResponse = Effect.fn('ExecutorRegistry.response')(function* (
  request: Request,
) {
  const url = URL.parse(request.url)
  if (url === null) {
    return yield* new RegistryQueryError({
      status: 400,
      message: 'Invalid integration registry URL.',
    })
  }
  const decoded = yield* Effect.mapError(
    Schema.decodeUnknownEffect(RegistryQuery)({
      query: url.searchParams.get('q'),
      category: url.searchParams.get('category'),
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      featured: url.searchParams.get('featured') === '1',
    }),
    (cause) =>
      new RegistryQueryError({
        status: 400,
        message: 'Invalid integration registry query.',
        cause,
      }),
  )

  if (decoded.featured) {
    return yield* Effect.mapError(
      getFeaturedExecutorCatalog(),
      (cause) =>
        new RegistryQueryError({
          status: 502,
          message: 'Integration catalog is unavailable.',
          cause,
        }),
    )
  }
  const query = Option.getOrElse(decoded.query, () => '')
    .trim()
    .toLowerCase()
  const category = Option.getOrElse(decoded.category, () => '')
    .trim()
    .toLowerCase()
  const limit = Math.min(
    Math.max(
      Option.getOrElse(decoded.limit, () => 40),
      1,
    ),
    100,
  )
  const offset = Math.max(
    Option.getOrElse(decoded.offset, () => 0),
    0,
  )
  return yield* Effect.mapError(
    searchExecutorCatalog({ query, category, limit, offset }),
    (cause) =>
      new RegistryQueryError({
        status: 502,
        message: 'Integration catalog is unavailable.',
        cause,
      }),
  )
})

export const Route = createFileRoute('/api/executor/registry')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const outcome = await runExecutorRouteEffect({
          effect: registryResponse(request),
          request,
          event: 'executor.registry.failed',
          fallbackMessage: 'Integration catalog is unavailable.',
        })
        if (!outcome.ok) return outcome.response
        return Response.json(
          Schema.encodeSync(ExecutorRegistrySearchResponse)(outcome.value),
        )
      },
    },
  },
})
