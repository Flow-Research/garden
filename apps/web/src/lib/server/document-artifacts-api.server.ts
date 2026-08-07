import { Cause, Effect, Layer, Result } from 'effect'
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { GardenDocumentsApi } from '@/lib/api/document-artifact-contract'
import type { AppRequestContext } from './context'
import {
  DocumentArtifacts,
  documentArtifactsLayer,
} from './document-artifacts-service'
import { AppRequest } from './effect-context'

export const documentArtifactsApiHandlers = HttpApiBuilder.group(
  GardenDocumentsApi,
  'documentArtifacts',
  (handlers) =>
    handlers
      .handle('get', ({ params }) =>
        Effect.gen(function* () {
          const documents = yield* DocumentArtifacts
          return yield* documents.get(params.id)
        }),
      )
      .handle('apply', ({ params, payload }) =>
        Effect.gen(function* () {
          const documents = yield* DocumentArtifacts
          return yield* documents.apply(params.id, payload)
        }),
      )
      .handle('events', ({ params }) =>
        Effect.gen(function* () {
          const documents = yield* DocumentArtifacts
          const stream = yield* documents.subscribe(params.id)
          return HttpServerResponse.fromWeb(
            new Response(stream, {
              headers: {
                'Cache-Control': 'no-cache',
                'Content-Type': 'text/event-stream; charset=utf-8',
              },
            }),
          )
        }),
      ),
)

const malformedJsonMiddleware = HttpRouter.middleware((effect) =>
  Effect.catchCause(effect, (cause) => {
    const defect = Cause.findDefect(cause)
    return Result.isSuccess(defect) && defect.success instanceof SyntaxError
      ? Effect.succeed(HttpServerResponse.empty({ status: 400 }))
      : Effect.failCause(cause)
  }),
)

export const documentArtifactsApiRouterLayer = HttpApiBuilder.layer(
  GardenDocumentsApi,
).pipe(
  Layer.provide(documentArtifactsApiHandlers),
  Layer.provide(malformedJsonMiddleware.layer),
  Layer.provide(HttpServer.layerServices),
)

/** Builds request services without caching Worker-owned request resources. */
export function makeDocumentArtifactsRequestContext(
  context: AppRequestContext,
) {
  return Effect.runPromise(
    Layer.build(
      documentArtifactsLayer.pipe(
        Layer.provide(Layer.succeed(AppRequest, context)),
      ),
    ).pipe(Effect.scoped),
  )
}

export const documentArtifactsApiWebHandler = HttpRouter.toWebHandler(
  documentArtifactsApiRouterLayer,
  { disableLogger: true },
).handler
