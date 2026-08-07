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
import type { SkillError, SkillOperationError } from '@garden/core/skills'
import { GardenSkillsApi } from '@/lib/api/skills-contract'
import { databaseLayer } from './effect-database'
import { skillBundlesLayer } from './skill-bundles'
import { skillDocumentsLayer } from './skill-documents'
import { Skills, skillsLayer, type SkillsService } from './skills-service'
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

const workspaceLayer = workspaceAccessLayer.pipe(Layer.provide(databaseLayer))
const skillsShLive = skillsShLayer.pipe(
  Layer.provide(Layer.mergeAll(skillDocumentsLayer, FetchHttpClient.layer)),
)

/** Live Skills graph; callers decide when request-owned database acquisition begins. */
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

/**
 * Creates a Skills facade that acquires the live request Layer only when an
 * endpoint calls a Skills operation. The first combined Garden API built the
 * live Layer for document, OPTIONS, and unknown routes, which opened the Skills
 * database before routing or document decoding. `Effect.provide` keeps Layer
 * acquisition scoped to the selected Skills operation. Reference: installed
 * Effect beta.85 `Effect.provide` and `Layer` implementations.
 */
export function makeDeferredSkillsService(
  liveLayer: Layer.Layer<Skills, SkillOperationError>,
): SkillsService {
  const withSkills = <A>(
    run: (skills: SkillsService) => Effect.Effect<A, SkillError>,
  ) => Effect.flatMap(Skills, run).pipe(Effect.provide(liveLayer))

  return Skills.of({
    list: () => withSkills((skills) => skills.list()),
    get: (id) => withSkills((skills) => skills.get(id)),
    create: (input) => withSkills((skills) => skills.create(input)),
    update: (id, input) => withSkills((skills) => skills.update(id, input)),
    remove: (id) => withSkills((skills) => skills.remove(id)),
    import: (input) => withSkills((skills) => skills.import(input)),
    search: (input) => withSkills((skills) => skills.search(input)),
    preview: (input) => withSkills((skills) => skills.preview(input)),
    listAgentAssignments: (agentId) =>
      withSkills((skills) => skills.listAgentAssignments(agentId)),
    setAgentAssignments: (agentId, input) =>
      withSkills((skills) => skills.setAgentAssignments(agentId, input)),
  })
}

/** Captures request authority without opening Skills database or storage. */
export const lazyRequestSkillsLayer = Layer.effect(
  Skills,
  Effect.gen(function* () {
    const request = yield* AppRequest
    const liveLayer = requestSkillsLayer.pipe(
      Layer.provide(Layer.succeed(AppRequest, request)),
    )
    return makeDeferredSkillsService(liveLayer)
  }),
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
