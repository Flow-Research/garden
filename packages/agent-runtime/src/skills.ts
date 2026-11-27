import { and, eq, or } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'
import { SkillResourceNotFoundError, r2, type SkillSource } from 'agents/skills'
import {
  agentSkillTarget,
  workspaceChatSkillTarget,
  type SkillTarget,
} from '@garden/core/skills'
import {
  derivePermissions,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import { getPooledDb } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import { workspaceSkillR2Prefix } from './skill-storage-paths'
import {
  allowedSlugsForPermissions,
  filterBuiltinSkillSource,
  filterSkillRowsByAllowedSlugs,
} from './skills-filter'

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
  readonly permissions: AgentPermissions | null
}

export type RuntimeSkillAssignment = {
  readonly name: string
  readonly slug: string
}

export class RuntimeSkillSourceError extends Schema.TaggedError<RuntimeSkillSourceError>()(
  'RuntimeSkillSourceError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface RuntimeSkillEnvironmentService {
  readonly bucket: R2Bucket
  readonly databaseUrl: string
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

const sourceOperation = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new RuntimeSkillSourceError({
        operation,
        message: `Failed to ${operation}.`,
        cause,
      }),
  })

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

  // Think reuses SkillSource objects across turns, so assignments must be
  // re-queried on each list/read — a one-shot load would freeze an empty set
  // after the first turn with no assignments.
  const refreshAssignments = Effect.fn(
    'RuntimeSkillSources.refreshAssignments',
  )(function* () {
    const assignments = yield* input.loadAssignments()
    assignedNames = new Set(assignments.map((assignment) => assignment.name))
  })

  return {
    id: base.id,
    list: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* refreshAssignments()
          if (assignedNames.size === 0) {
            return { ok: true as const, value: { skills: [], invalid: [] } }
          }
          const listed = yield* sourceOperation('list assigned skills', () =>
            base.list(),
          )
          if (!listed.ok) return listed
          return {
            ok: true as const,
            value: {
              skills: listed.value.skills.filter((entry) =>
                assignedNames.has(entry.skill.name),
              ),
              // An invalid manifest has no verified skill identity.
              invalid: [],
            },
          }
        }),
      ),
    readResource: (skill, path) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* refreshAssignments()
          if (!assignedNames.has(skill)) {
            return {
              ok: false as const,
              error: new SkillResourceNotFoundError(skill, path),
            }
          }
          return yield* sourceOperation('read assigned skill resource', () =>
            base.readResource(skill, path),
          )
        }),
      ),
  }
}

export const runtimeSkillSourcesLayer = Layer.effect(
  RuntimeSkillSources,
  Effect.gen(function* () {
    const environment = yield* RuntimeSkillEnvironment
    const db = getPooledDb(environment.databaseUrl)

    const identity = Effect.fn('RuntimeSkillSources.identity')(function* (
      subject: RuntimeSkillSubject,
    ) {
      if (subject.kind === 'target') {
        if (subject.target.kind === 'agent') {
          const rows = yield* sourceOperation(
            'load target agent permissions',
            () =>
              db
                .select({ permissions: schema.agent.permissions })
                .from(schema.agent)
                .where(eq(schema.agent.id, subject.target.id))
                .limit(1),
          )
          const row = rows[0]
          return {
            workspaceId: subject.workspaceId,
            target: subject.target,
            permissions: row
              ? derivePermissions({ agent: { permissions: row.permissions } })
              : null,
          }
        }
        return {
          workspaceId: subject.workspaceId,
          target: subject.target,
          permissions: null,
        }
      }
      if (subject.kind === 'chat') {
        const rows = yield* sourceOperation('load chat skill target', () =>
          db
            .select({
              workspaceId: schema.chatThread.workspaceId,
              agentId: schema.chatThread.agentId,
              isDefault: schema.agent.isDefault,
              agentPermissions: schema.agent.permissions,
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
        return {
          workspaceId: row.workspaceId,
          target,
          permissions: derivePermissions({
            agent: { permissions: row.agentPermissions },
          }),
        }
      }
      if (subject.kind === 'issue') {
        const rows = yield* sourceOperation('load issue skill target', () =>
          db
            .select({
              workspaceId: schema.issueRun.workspaceId,
              agentId: schema.issueRun.agentId,
              agentPermissions: schema.agent.permissions,
              issuePermissionsOverride: schema.issue.permissionsOverride,
            })
            .from(schema.issue)
            .innerJoin(
              schema.issueRun,
              eq(schema.issueRun.id, schema.issue.activeRunId),
            )
            .innerJoin(
              schema.agent,
              eq(schema.agent.id, schema.issueRun.agentId),
            )
            .where(eq(schema.issue.id, subject.id))
            .limit(1),
        )
        const row = rows[0]
        return row
          ? {
              workspaceId: row.workspaceId,
              target: agentSkillTarget(row.agentId),
              permissions: derivePermissions({
                agent: { permissions: row.agentPermissions },
                issue: { permissionsOverride: row.issuePermissionsOverride },
              }),
            }
          : null
      }
      const rows = yield* sourceOperation('load automation skill target', () =>
        db
          .select({
            workspaceId: schema.automationRun.workspaceId,
            agentId: schema.automationRun.agentId,
            agentPermissions: schema.agent.permissions,
          })
          .from(schema.automationRun)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.automationRun.agentId),
          )
          .where(eq(schema.automationRun.id, subject.id))
          .limit(1),
      )
      const row = rows[0]
      return row
        ? {
            workspaceId: row.workspaceId,
            target: agentSkillTarget(row.agentId),
            permissions: derivePermissions({
              agent: { permissions: row.agentPermissions },
            }),
          }
        : null
    })

    const assignmentsForIdentity = Effect.fn(
      'RuntimeSkillSources.assignmentsForIdentity',
    )(function* (resolved: RuntimeSkillIdentity) {
      const rows = yield* sourceOperation('load skill assignments', () =>
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
      return filterSkillRowsByAllowedSlugs(
        rows,
        allowedSlugsForPermissions(resolved.permissions),
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
        filterBuiltinSkillSource(
          r2(environment.bucket, {
            id: 'garden-builtins',
            prefix: `${BUILTIN_SKILL_R2_PREFIX}/`,
            refreshIntervalMs: 0,
          }),
          resolved?.permissions ?? null,
        ),
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
