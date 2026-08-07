import { and, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  SkillConflictError,
  SkillMetadata,
  SkillNotFoundError,
  SkillOperationError,
  SkillValidationError,
  workspaceChatSkillTarget,
  type AgentSkill,
  type CreateSkillRequest,
  type ImportSkillRequest,
  type SearchSkillsRequest,
  type SetAgentSkillsRequest,
  type Skill,
  type SkillError,
  type SkillFile,
  type SkillMetadata as SkillMetadataValue,
  type SkillPreview,
  type SkillsShSearchResult,
  type UpdateSkillRequest,
} from '@garden/core/skills'
import { schema } from './db'
import { Database } from './effect-database'
import { SkillBundles, type StoredSkillBundleFile } from './skill-bundles'
import { SkillDocuments } from './skill-documents'
import { SkillsSh } from './skills-sh'
import { WorkspaceAccess } from './workspace-access'

type SkillRow = typeof schema.skill.$inferSelect
type SkillFileRow = typeof schema.skillFile.$inferSelect

export interface SkillsService {
  readonly list: () => Effect.Effect<Skill[], SkillError>
  readonly get: (id: string) => Effect.Effect<Skill, SkillError>
  readonly create: (
    input: CreateSkillRequest,
  ) => Effect.Effect<Skill, SkillError>
  readonly update: (
    id: string,
    input: UpdateSkillRequest,
  ) => Effect.Effect<Skill, SkillError>
  readonly remove: (id: string) => Effect.Effect<void, SkillError>
  readonly import: (
    input: ImportSkillRequest,
  ) => Effect.Effect<Skill, SkillError>
  readonly search: (
    input: SearchSkillsRequest,
  ) => Effect.Effect<SkillsShSearchResult[], SkillError>
  readonly preview: (
    input: ImportSkillRequest,
  ) => Effect.Effect<SkillPreview, SkillError>
  readonly listAgentAssignments: (
    agentId: string,
  ) => Effect.Effect<AgentSkill[], SkillError>
  readonly setAgentAssignments: (
    agentId: string,
    input: SetAgentSkillsRequest,
  ) => Effect.Effect<void, SkillError>
}

export class Skills extends Context.Service<Skills, SkillsService>()(
  '@garden/web/Skills',
) {}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Request-scoped skill domain. Database, storage, document, and HTTP adapters are yielded once by the Layer. */
export const skillsLayer = Layer.effect(
  Skills,
  Effect.gen(function* () {
    const { db } = yield* Database
    const access = yield* WorkspaceAccess
    const bundles = yield* SkillBundles
    const documents = yield* SkillDocuments
    const skillsSh = yield* SkillsSh

    const operation = <A>(name: string, run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new SkillOperationError({
            operation: name,
            message: `Failed to ${name}.`,
            cause,
          }),
      })

    const decodeMetadata: (
      row: SkillRow,
    ) => Effect.Effect<SkillMetadataValue, SkillValidationError> = Effect.fn(
      'Skills.decodeMetadata',
    )(function* (row: SkillRow) {
      const frontmatterText = row.frontmatter
      const fallback = Schema.decodeUnknownEffect(SkillMetadata)({
        name: row.name,
        description: row.description ?? '',
      })
      const decoded = (
        frontmatterText
          ? Schema.decodeUnknownEffect(Schema.fromJsonString(SkillMetadata))(
              frontmatterText,
            )
          : fallback
      ).pipe(
        Effect.catch(() => fallback),
        Effect.mapError(
          () =>
            new SkillValidationError({
              operation: 'decode skill metadata',
              message: 'Stored skill metadata is invalid',
            }),
        ),
      )
      return yield* decoded
    })

    const mapSkill = Effect.fn('Skills.mapSkill')(function* (
      row: SkillRow,
      files: ReadonlyArray<SkillFile> = [],
    ) {
      const createdAt = (row.createdAt ?? new Date()).toISOString()
      return {
        id: row.id,
        workspace_id: row.workspaceId,
        slug: row.slug,
        name: row.name,
        description: row.description ?? '',
        content: row.body ?? '',
        config: yield* decodeMetadata(row),
        files: [...files],
        source_type:
          row.sourceType === 'skills.sh' || row.sourceType === 'builtin'
            ? row.sourceType
            : 'manual',
        source_url: row.sourceUrl ?? null,
        bundle_hash: row.bundleHash ?? null,
        created_by: row.authorId ?? null,
        created_at: createdAt,
        updated_at: (
          row.updatedAt ??
          row.createdAt ??
          new Date()
        ).toISOString(),
      } satisfies Skill
    })

    const fileRows = (skillId: string) =>
      operation('load skill files', () =>
        db
          .select()
          .from(schema.skillFile)
          .where(eq(schema.skillFile.skillId, skillId)),
      )

    const loadFullSkill = Effect.fn('Skills.loadFullSkill')(function* (
      row: SkillRow,
    ) {
      const rows = yield* fileRows(row.id)
      const files = yield* bundles.loadFiles(rows)
      return yield* mapSkill(row, files)
    })

    const loadSkill = Effect.fn('Skills.loadSkill')(function* (id: string) {
      const rows = yield* operation('load skill', () =>
        db.select().from(schema.skill).where(eq(schema.skill.id, id)).limit(1),
      )
      const row = rows[0]
      if (!row) {
        return yield* new SkillNotFoundError({
          resource: 'skill',
          id,
          message: 'Skill not found',
        })
      }
      yield* access.require(row.workspaceId)
      return row
    })

    const assignmentValues = (
      workspaceId: string,
      skillId: string,
    ): typeof schema.skillAssignment.$inferInsert => {
      const target = workspaceChatSkillTarget(workspaceId)
      return {
        workspaceId,
        targetKind: target.kind,
        targetId: target.id,
        skillId,
        enabled: true,
      }
    }

    const storedRows = (
      files: ReadonlyArray<StoredSkillBundleFile>,
    ): SkillFileRow[] =>
      files.map((file) => ({
        ...file,
      }))

    const list = Effect.fn('Skills.list')(function* () {
      const workspace = yield* access.currentOptional()
      if (!workspace) return []
      const rows = yield* operation('list skills', () =>
        db
          .select()
          .from(schema.skill)
          .where(eq(schema.skill.workspaceId, workspace.workspaceId)),
      )
      return yield* Effect.forEach(rows, (row) => mapSkill(row))
    })

    const get = Effect.fn('Skills.get')(function* (id: string) {
      return yield* loadFullSkill(yield* loadSkill(id))
    })

    const create = Effect.fn('Skills.create')(function* (
      input: CreateSkillRequest,
    ) {
      const workspace = yield* access.current()
      const description = input.description?.trim() ?? ''
      if (!input.content && !description) {
        return yield* new SkillValidationError({
          operation: 'create skill',
          message: 'Skill description is required',
        })
      }
      const files = yield* bundles.normalizeFiles(input.files)
      const content = input.content
        ? input.content
        : yield* documents.build({
            name: input.name,
            description,
            frontmatter: input.config,
          })
      const parsed = yield* documents.parse(content)
      const slug = slugify(parsed.name)
      if (!slug) {
        return yield* new SkillValidationError({
          operation: 'create skill',
          message: 'Skill name must contain letters or numbers',
        })
      }
      const conflicts = yield* operation('check skill slug', () =>
        db
          .select({ id: schema.skill.id })
          .from(schema.skill)
          .where(
            and(
              eq(schema.skill.workspaceId, workspace.workspaceId),
              eq(schema.skill.slug, slug),
            ),
          )
          .limit(1),
      )
      if (conflicts[0]) {
        return yield* new SkillConflictError({
          resource: 'skill',
          id: conflicts[0].id,
          message: 'A skill with this name already exists',
        })
      }

      const id = crypto.randomUUID()
      const bundleHash = yield* bundles.hash({ content, files })
      const stored = yield* bundles.storeFiles({
        workspaceId: workspace.workspaceId,
        skillId: id,
        bundleHash,
        files,
      })
      yield* bundles.persistRuntime({
        workspaceId: workspace.workspaceId,
        slug,
        content,
        files,
      })

      const row = yield* operation('create skill', () =>
        db.transaction(async (tx) => {
          const inserted = await tx
            .insert(schema.skill)
            .values({
              id,
              workspaceId: workspace.workspaceId,
              name: parsed.name,
              slug,
              description: parsed.description,
              frontmatter: JSON.stringify(parsed.frontmatter),
              body: content,
              sourceType: 'manual',
              sourceUrl: null,
              bundleHash,
              authorId: workspace.userId,
            })
            .returning()
          if (stored.length > 0) {
            await tx.insert(schema.skillFile).values(stored)
          }
          await tx
            .insert(schema.skillAssignment)
            .values(assignmentValues(workspace.workspaceId, id))
          return inserted[0] ?? null
        }),
      ).pipe(
        Effect.onError(() =>
          Effect.all(
            [
              bundles.deleteFiles(storedRows(stored)),
              bundles.deleteRuntime({
                workspaceId: workspace.workspaceId,
                slug,
              }),
            ],
            { discard: true },
          ).pipe(Effect.ignore),
        ),
      )
      if (!row) {
        return yield* new SkillOperationError({
          operation: 'create skill',
          message: 'Failed to create skill.',
        })
      }
      return yield* loadFullSkill(row)
    })

    const update = Effect.fn('Skills.update')(function* (
      id: string,
      input: UpdateSkillRequest,
    ) {
      if (Object.keys(input).length === 0) {
        return yield* new SkillValidationError({
          operation: 'update skill',
          message: 'No valid skill changes submitted',
        })
      }
      const existing = yield* loadSkill(id)
      const oldFileRows = yield* fileRows(id)
      const oldFiles = yield* bundles.loadFiles(oldFileRows)
      const content = yield* documents.update({
        raw: input.content ?? existing.body ?? '',
        name: input.name,
        description: input.description,
        frontmatter: input.config,
      })
      const parsed = yield* documents.parse(content)
      const files = input.files
        ? yield* bundles.normalizeFiles(input.files)
        : oldFiles.map((file) => ({ path: file.path, content: file.content }))
      const bundleHash = yield* bundles.hash({ content, files })
      const stored = input.files
        ? yield* bundles.storeFiles({
            workspaceId: existing.workspaceId,
            skillId: id,
            bundleHash,
            files,
          })
        : null
      const rows = yield* operation('update skill', () =>
        db.transaction(async (tx) => {
          const updated = await tx
            .update(schema.skill)
            .set({
              name: parsed.name,
              description: parsed.description,
              frontmatter: JSON.stringify(parsed.frontmatter),
              body: content,
              bundleHash,
              updatedAt: new Date(),
            })
            .where(eq(schema.skill.id, id))
            .returning()
          if (stored) {
            await tx
              .delete(schema.skillFile)
              .where(eq(schema.skillFile.skillId, id))
            if (stored.length > 0) {
              await tx.insert(schema.skillFile).values(stored)
            }
          }
          return updated
        }),
      )
      const row = rows[0]
      if (!row) {
        return yield* new SkillNotFoundError({
          resource: 'skill',
          id,
          message: 'Skill not found',
        })
      }
      if (stored) yield* bundles.deleteFiles(oldFileRows)
      yield* bundles.persistRuntime({
        workspaceId: existing.workspaceId,
        slug: existing.slug,
        content,
        files,
      })
      return yield* loadFullSkill(row)
    })

    const remove = Effect.fn('Skills.remove')(function* (id: string) {
      const existing = yield* loadSkill(id)
      const files = yield* fileRows(id)
      yield* bundles.deleteFiles(files)
      yield* bundles.deleteRuntime({
        workspaceId: existing.workspaceId,
        slug: existing.slug,
      })
      yield* operation('delete skill', () =>
        db.delete(schema.skill).where(eq(schema.skill.id, id)),
      )
    })

    const importSkill = Effect.fn('Skills.import')(function* (
      input: ImportSkillRequest,
    ) {
      const workspace = yield* access.current()
      const imported = yield* skillsSh.download(input)
      const existingRows = yield* operation('find imported skill', () =>
        db
          .select()
          .from(schema.skill)
          .where(
            and(
              eq(schema.skill.workspaceId, workspace.workspaceId),
              eq(schema.skill.slug, imported.slug),
            ),
          )
          .limit(1),
      )
      const existing = existingRows[0]
      const id = existing?.id ?? crypto.randomUUID()
      const oldFiles = existing ? yield* fileRows(id) : []
      const stored = yield* bundles.storeFiles({
        workspaceId: workspace.workspaceId,
        skillId: id,
        bundleHash: imported.bundleHash,
        files: imported.files,
      })
      yield* bundles.persistRuntime({
        workspaceId: workspace.workspaceId,
        slug: imported.slug,
        content: imported.content,
        files: imported.files,
      })

      const row = yield* operation('import skill', () =>
        db.transaction(async (tx) => {
          const values = {
            workspaceId: workspace.workspaceId,
            name: imported.name,
            slug: imported.slug,
            description: imported.description,
            frontmatter: JSON.stringify(imported.config),
            body: imported.content,
            sourceType: imported.sourceType,
            sourceUrl: imported.sourceUrl,
            bundleHash: imported.bundleHash,
            authorId: workspace.userId,
            updatedAt: new Date(),
          }
          const rows = existing
            ? await tx
                .update(schema.skill)
                .set(values)
                .where(eq(schema.skill.id, id))
                .returning()
            : await tx
                .insert(schema.skill)
                .values({ id, ...values })
                .returning()
          await tx
            .delete(schema.skillFile)
            .where(eq(schema.skillFile.skillId, id))
          if (stored.length > 0) {
            await tx.insert(schema.skillFile).values(stored)
          }
          const assignment = assignmentValues(workspace.workspaceId, id)
          await tx
            .insert(schema.skillAssignment)
            .values(assignment)
            .onConflictDoUpdate({
              target: [
                schema.skillAssignment.workspaceId,
                schema.skillAssignment.targetKind,
                schema.skillAssignment.targetId,
                schema.skillAssignment.skillId,
              ],
              set: { enabled: true, updatedAt: new Date() },
            })
          return rows[0] ?? null
        }),
      )
      if (!row) {
        return yield* new SkillOperationError({
          operation: 'import skill',
          message: 'Failed to import skill.',
        })
      }
      yield* bundles.deleteFiles(oldFiles)
      return yield* loadFullSkill(row)
    })

    const search = Effect.fn('Skills.search')(function* (
      input: SearchSkillsRequest,
    ) {
      yield* access.currentOptional()
      return yield* skillsSh.search(input.q ?? '', input.limit ?? 10)
    })

    const preview = Effect.fn('Skills.preview')(function* (
      input: ImportSkillRequest,
    ) {
      yield* access.current()
      const imported = yield* skillsSh.download(input)
      return {
        name: imported.name,
        description: imported.description,
        slug: imported.slug,
        content: imported.content,
        files: imported.files,
        source_url: imported.sourceUrl,
        bundle_hash: imported.bundleHash,
      }
    })

    const listAgentAssignments = Effect.fn('Skills.listAgentAssignments')(
      function* (agentId: string) {
        const { workspace, target } = yield* access.targetForAgent(agentId)
        const rows = yield* operation('list skill assignments', () =>
          db
            .select({
              skill: schema.skill,
              enabled: schema.skillAssignment.enabled,
            })
            .from(schema.skillAssignment)
            .innerJoin(
              schema.skill,
              eq(schema.skill.id, schema.skillAssignment.skillId),
            )
            .where(
              and(
                eq(schema.skillAssignment.workspaceId, workspace.workspaceId),
                eq(schema.skillAssignment.targetKind, target.kind),
                eq(schema.skillAssignment.targetId, target.id),
              ),
            ),
        )
        return yield* Effect.forEach(rows, (row) =>
          mapSkill(row.skill).pipe(
            Effect.map(
              (skill) =>
                ({ ...skill, enabled: row.enabled }) satisfies AgentSkill,
            ),
          ),
        )
      },
    )

    const setAgentAssignments = Effect.fn('Skills.setAgentAssignments')(
      function* (agentId: string, input: SetAgentSkillsRequest) {
        const { workspace, target } = yield* access.targetForAgent(agentId)
        const ids = [...new Set(input.skills.map((item) => item.skill_id))]
        const allowed =
          ids.length === 0
            ? []
            : yield* operation('validate skill assignments', () =>
                db
                  .select({ id: schema.skill.id })
                  .from(schema.skill)
                  .where(
                    and(
                      eq(schema.skill.workspaceId, workspace.workspaceId),
                      inArray(schema.skill.id, ids),
                    ),
                  ),
              )
        if (allowed.length !== ids.length) {
          return yield* new SkillValidationError({
            operation: 'set skill assignments',
            message: 'One or more skills are outside this workspace',
          })
        }

        yield* operation('set skill assignments', () =>
          db.transaction(async (tx) => {
            await tx
              .delete(schema.skillAssignment)
              .where(
                and(
                  eq(schema.skillAssignment.workspaceId, workspace.workspaceId),
                  eq(schema.skillAssignment.targetKind, target.kind),
                  eq(schema.skillAssignment.targetId, target.id),
                ),
              )
            if (input.skills.length > 0) {
              await tx.insert(schema.skillAssignment).values(
                input.skills.map((item) => ({
                  workspaceId: workspace.workspaceId,
                  targetKind: target.kind,
                  targetId: target.id,
                  skillId: item.skill_id,
                  enabled: item.enabled,
                })),
              )
            }
          }),
        )
      },
    )

    return Skills.of({
      list,
      get,
      create,
      update,
      remove,
      import: importSkill,
      search,
      preview,
      listAgentAssignments,
      setAgentAssignments,
    })
  }),
)
