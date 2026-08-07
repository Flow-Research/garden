import { Cause, Effect, Layer, Result } from 'effect'
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { GardenApi } from '@/lib/api/garden-api-contract'
import type { AppRequestContext } from './context'
import { documentArtifactsApiHandlers } from './document-artifacts-api.server'
import { documentArtifactsLayer } from './document-artifacts-service'
import { appRequestContext } from './effect-context'
import { lazyRequestSkillsLayer, skillsApiHandlers } from './skills-api.server'

const malformedJsonMiddleware = HttpRouter.middleware((effect) =>
  Effect.catchCause(effect, (cause) => {
    const defect = Cause.findDefect(cause)
    return Result.isSuccess(defect) && defect.success instanceof SyntaxError
      ? Effect.succeed(HttpServerResponse.empty({ status: 400 }))
      : Effect.failCause(cause)
  }),
)

/** Request services required by the combined API without eager Skills I/O. */
export const requestGardenApiLayer = Layer.mergeAll(
  lazyRequestSkillsLayer,
  documentArtifactsLayer,
)

/**
 * Registers every Garden API group in one Effect router. Before this merge,
 * TanStack's single `/api/$` route could mount either skills or documents, so
 * the other contract became unreachable depending on merge resolution.
 */
export const gardenApiRouterLayer = HttpApiBuilder.layer(GardenApi).pipe(
  Layer.provide(
    Layer.mergeAll(skillsApiHandlers, documentArtifactsApiHandlers),
  ),
  Layer.provide(malformedJsonMiddleware.layer),
  Layer.provide(HttpServer.layerServices),
)

/** Acquires both API groups from the same Worker-owned request context. */
export function makeGardenApiRequestContext(context: AppRequestContext) {
  return Effect.runPromise(
    Layer.build(
      requestGardenApiLayer.pipe(
        Layer.provide(Layer.succeedContext(appRequestContext(context))),
      ),
    ).pipe(Effect.scoped),
  )
}

export const gardenApiWebHandler = HttpRouter.toWebHandler(
  gardenApiRouterLayer,
  { disableLogger: true },
).handler
