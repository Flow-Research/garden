import { Cause, Effect, Layer, Result } from 'effect'
import {
  FetchHttpClient,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from 'effect/unstable/http'
import type { AppRequestContext } from './context'
import { AppRequest } from './effect-context'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { GardenSkillsApi } from '@/lib/api/skills-contract'
import { databaseLayer } from './effect-database'
import { skillBundlesLayer } from './skill-bundles'
import { skillDocumentsLayer } from './skill-documents'
import { Skills } from './skills-service'
import { skillsLayer } from './skills-service'
import { skillsShLayer } from './skills-sh'
import { workspaceAccessLayer } from './workspace-access'

export const skillsApiHandlers = HttpApiBuilder.group(
  GardenSkillsApi,
  'skills',
  (handlers) =>
    handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.list()
        }),
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.create(payload)
        }),
      )
      .handle('get', ({ params }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.get(params.id)
        }),
      )
      .handle('update', ({ params, payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.update(params.id, payload)
        }),
      )
      .handle('replace', ({ params, payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.update(params.id, payload)
        }),
      )
      .handle('remove', ({ params }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.remove(params.id)
        }),
      )
      .handle('import', ({ payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.import(payload)
        }),
      )
      .handle('search', ({ query }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.search(query)
        }),
      )
      .handle('preview', ({ payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.preview(payload)
        }),
      )
      .handle('listAgentAssignments', ({ params }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.listAgentAssignments(params.id)
        }),
      )
      .handle('setAgentAssignments', ({ params, payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.setAgentAssignments(params.id, payload)
        }),
      ),
)

const workspaceLayer = workspaceAccessLayer.pipe(
  Layer.provide(databaseLayer),
)
const skillsShLive = skillsShLayer.pipe(
  Layer.provide(
    Layer.mergeAll(skillDocumentsLayer, FetchHttpClient.layer),
  ),
)

/** Built per HTTP request by HttpRouter.provideRequest; never memoized across Worker requests. */
export const requestSkillsLayer = skillsLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      databaseLayer,
      workspaceLayer,
      skillBundlesLayer,
      skillDocumentsLayer,
      skillsShLive,
    ),
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

export const skillsApiRouterLayer = HttpApiBuilder.layer(GardenSkillsApi).pipe(
  Layer.provide(skillsApiHandlers),
  Layer.provide(malformedJsonMiddleware.layer),
  Layer.provide(HttpServer.layerServices),
)

/** Acquires request services from the current TanStack context only. */
export function makeSkillsRequestContext(context: AppRequestContext) {
  return Effect.runPromise(
    Layer.build(
      requestSkillsLayer.pipe(
        Layer.provide(Layer.succeed(AppRequest, context)),
      ),
    ).pipe(Effect.scoped),
  )
}

export const skillsApiWebHandler = HttpRouter.toWebHandler(
  skillsApiRouterLayer,
  {
    disableLogger: true,
  },
).handler
