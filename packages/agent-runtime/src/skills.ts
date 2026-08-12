import { and, eq, or } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'
import { r2, type SkillSource } from 'agents/skills'
import {
  agentSkillTarget,
  workspaceChatSkillTarget,
  type SkillTarget,
} from '@garden/core/skills'
import type { GardenDatabase } from '@garden/db'
import * as schema from '@garden/db/schema'
import { workspaceSkillR2Prefix } from './skill-storage-paths'

const BUILTIN_SKILL_R2_PREFIX = 'builtin-skills'

export type RuntimeSkillSubject =
  | { readonly kind: 'chat'; readonly id: string }
  | { readonly kind: 'issue'; readonly id: string }
  | { readonly kind: 'automation'; readonly id: string }
  | {
      readonly kind: 'target'
      readonly workspaceId: string
      readonly target: SkillTarget
    }

export type RuntimeSkillIdentity = {
  readonly workspaceId: string
  readonly target: SkillTarget
}

export type RuntimeSkillAssignment = {
  readonly name: string
  readonly slug: string
}

export class RuntimeSkillSourceError extends Schema.TaggedErrorClass<RuntimeSkillSourceError>()(
  'RuntimeSkillSourceError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface RuntimeSkillEnvironmentService {
  readonly bucket: R2Bucket
  readonly database: GardenDatabase
}

export class RuntimeSkillEnvironment extends Context.Service<
  RuntimeSkillEnvironment,
  RuntimeSkillEnvironmentService
>()('@garden/agent-runtime/RuntimeSkillEnvironment') {}

export interface RuntimeSkillSourcesService {
  readonly identity: (
    subject: RuntimeSkillSubject,
  ) => Effect.Effect<RuntimeSkillIdentity | null, RuntimeSkillSourceError>
  readonly assignments: (
    subject: RuntimeSkillSubject,
  ) => Effect.Effect<RuntimeSkillAssignment[], RuntimeSkillSourceError>
  readonly sources: (
    subject: RuntimeSkillSubject,
  ) => Effect.Effect<SkillSource[], RuntimeSkillSourceError>
}

export class RuntimeSkillSources extends Context.Service<
  RuntimeSkillSources,
  RuntimeSkillSourcesService
>()('@garden/agent-runtime/RuntimeSkillSources') {}

function dynamicAssignedSource(input: {
  readonly bucket: R2Bucket
  readonly identity: RuntimeSkillIdentity
  readonly loadAssignments: () => Effect.Effect<
    RuntimeSkillAssignment[],
    RuntimeSkillSourceError
  >
}): SkillSource {
  const base = r2(input.bucket, {
    id: `garden-workspace:${input.identity.workspaceId}`,
    prefix: workspaceSkillR2Prefix(input.identity.workspaceId),
    refreshIntervalMs: 0,
  })
  let assignedNames: ReadonlySet<string> = new Set()
  let assignmentFingerprint = ''
  let loaded = false

  const refreshAssignments = Effect.fn(
    'RuntimeSkillSources.refreshAssignments',
  )(function* () {
    const assignments = yield* input.loadAssignments()
    const names = assignments
      .map((assignment) => assignment.name)
      .sort((left, right) => left.localeCompare(right))
    assignedNames = new Set(names)
    assignmentFingerprint = names.join(',')
    loaded = true
  })

  const ensureAssignments = () => (loaded ? Effect.void : refreshAssignments())

  const sdkCall = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new RuntimeSkillSourceError({
          operation,
          message: `Skill source ${operation} failed.`,
          cause,
        }),
    })

  return {
    id: base.id,
    get fingerprint() {
      return `${base.fingerprint}:assignments:${assignmentFingerprint}`
    },
    list: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* ensureAssignments()
          if (assignedNames.size === 0) return []
          const descriptors = yield* sdkCall('list', () => base.list())
          return descriptors.filter((descriptor) =>
            assignedNames.has(descriptor.name),
          )
        }),
      ),
    load: (name) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* ensureAssignments()
          if (!assignedNames.has(name)) return null
          return yield* sdkCall('load', () => base.load(name))
        }),
      ),
    readResource: (name, path) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* ensureAssignments()
          if (!assignedNames.has(name) || !base.readResource) return null
          return yield* sdkCall('read resource', () =>
            base.readResource
              ? base.readResource(name, path)
              : Promise.resolve(null),
          )
        }),
      ),
    refresh: () =>
      Effect.runPromise(
        Effect.all(
          [
            base.refresh
              ? sdkCall('refresh', () => base.refresh?.() ?? Promise.resolve())
              : Effect.void,
            refreshAssignments(),
          ],
          { discard: true },
        ),
      ),
  }
}

export const runtimeSkillSourcesLayer = Layer.effect(
  RuntimeSkillSources,
  Effect.gen(function* () {
    const environment = yield* RuntimeSkillEnvironment
    const db = environment.database

    const dbOperation = <A>(operation: string, run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new RuntimeSkillSourceError({
            operation,
            message: `Failed to ${operation}.`,
            cause,
          }),
      })

    const identity = Effect.fn('RuntimeSkillSources.identity')(function* (
      subject: RuntimeSkillSubject,
    ) {
      if (subject.kind === 'target') {
        return {
          workspaceId: subject.workspaceId,
          target: subject.target,
        }
      }
      if (subject.kind === 'chat') {
        const rows = yield* dbOperation('load chat skill target', () =>
          db
            .select({
              workspaceId: schema.chatThread.workspaceId,
              agentId: schema.chatThread.agentId,
              isDefault: schema.agent.isDefault,
            })
            .from(schema.chatThread)
            .innerJoin(
              schema.agent,
              eq(schema.agent.id, schema.chatThread.agentId),
            )
            .where(
              or(
                eq(schema.chatThread.id, subject.id),
                eq(schema.chatThread.runtimeKey, subject.id),
              ),
            )
            .limit(1),
        )
        const row = rows[0]
        if (!row) return null
        const target = row.isDefault
          ? workspaceChatSkillTarget(row.workspaceId)
          : agentSkillTarget(row.agentId)
        return { workspaceId: row.workspaceId, target }
      }
      if (subject.kind === 'issue') {
        const rows = yield* dbOperation('load issue skill target', () =>
          db
            .select({
              workspaceId: schema.issueRun.workspaceId,
              agentId: schema.issueRun.agentId,
            })
            .from(schema.issue)
            .innerJoin(
              schema.issueRun,
              eq(schema.issueRun.id, schema.issue.activeRunId),
            )
            .where(eq(schema.issue.id, subject.id))
            .limit(1),
        )
        const row = rows[0]
        return row
          ? {
              workspaceId: row.workspaceId,
              target: agentSkillTarget(row.agentId),
            }
          : null
      }
      const rows = yield* dbOperation('load automation skill target', () =>
        db
          .select({
            workspaceId: schema.automationRun.workspaceId,
            agentId: schema.automationRun.agentId,
          })
          .from(schema.automationRun)
          .where(eq(schema.automationRun.id, subject.id))
          .limit(1),
      )
      const row = rows[0]
      return row
        ? {
            workspaceId: row.workspaceId,
            target: agentSkillTarget(row.agentId),
          }
        : null
    })

    const assignmentsForIdentity = Effect.fn(
      'RuntimeSkillSources.assignmentsForIdentity',
    )(function* (resolved: RuntimeSkillIdentity) {
      return yield* dbOperation('load skill assignments', () =>
        db
          .select({ name: schema.skill.name, slug: schema.skill.slug })
          .from(schema.skillAssignment)
          .innerJoin(
            schema.skill,
            eq(schema.skill.id, schema.skillAssignment.skillId),
          )
          .where(
            and(
              eq(schema.skillAssignment.workspaceId, resolved.workspaceId),
              eq(schema.skillAssignment.targetKind, resolved.target.kind),
              eq(schema.skillAssignment.targetId, resolved.target.id),
              eq(schema.skillAssignment.enabled, true),
            ),
          ),
      )
    })

    const assignments = Effect.fn('RuntimeSkillSources.assignments')(function* (
      subject: RuntimeSkillSubject,
    ) {
      const resolved = yield* identity(subject)
      if (!resolved) return []
      return yield* assignmentsForIdentity(resolved)
    })

    const sources = Effect.fn('RuntimeSkillSources.sources')(function* (
      subject: RuntimeSkillSubject,
    ) {
      const resolved = yield* identity(subject)
      const sources: SkillSource[] = []
      if (resolved) {
        sources.push(
          dynamicAssignedSource({
            bucket: environment.bucket,
            identity: resolved,
            loadAssignments: () => assignmentsForIdentity(resolved),
          }),
        )
      }
      sources.push(
        r2(environment.bucket, {
          id: 'garden-builtins',
          prefix: `${BUILTIN_SKILL_R2_PREFIX}/`,
          refreshIntervalMs: 0,
        }),
      )
      return sources
    })

    return RuntimeSkillSources.of({ identity, assignments, sources })
  }),
)

function runtimeLayer(environment: RuntimeSkillEnvironmentService) {
  return runtimeSkillSourcesLayer.pipe(
    Layer.provide(Layer.succeed(RuntimeSkillEnvironment, environment)),
  )
}

/** Promise adapter required by Think.getSkills(). */
export function loadRuntimeSkillSources(
  environment: RuntimeSkillEnvironmentService,
  subject: RuntimeSkillSubject,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* RuntimeSkillSources
      return yield* service.sources(subject)
    }).pipe(Effect.provide(runtimeLayer(environment))),
  )
}

/** Promise adapter used for explicit slash activation and inventory display. */
export function loadRuntimeSkillAssignments(
  environment: RuntimeSkillEnvironmentService,
  subject: RuntimeSkillSubject,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* RuntimeSkillSources
      return yield* service.assignments(subject)
    }).pipe(Effect.provide(runtimeLayer(environment))),
  )
}
