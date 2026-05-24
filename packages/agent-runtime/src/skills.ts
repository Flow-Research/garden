import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { SkillProvider } from 'agents/experimental/memory/session'
import * as schema from '@garden/db/schema'
import {
  buildBuiltinSkillObjectKey,
  DOC_BUILTIN_SKILLS,
  type BuiltinSkillManifest,
} from './bundled-skills'

type Brand<TValue extends string, TName extends string> = TValue & {
  readonly __brand: TName
}

const SKILL_MOUNT_ROOT = '/.agents/skills'
const SKILL_MD_FILENAME = 'SKILL.md'

export type RuntimeAgentId = Brand<string, 'RuntimeAgentId'>
export type RuntimeSkillId = Brand<string, 'RuntimeSkillId'>
export type RuntimeSkillSlug = Brand<string, 'RuntimeSkillSlug'>

type SkillCatalogRecord = {
  agentId: RuntimeAgentId
  skillId: RuntimeSkillId
  skillSlug: RuntimeSkillSlug
  skillName: string
  skillDescription: string | null
  skillBody: string | null
  skillBodyR2Key: string | null
  sourceUrl: string | null
  enabled: boolean
  filePath: string | null
  fileContentHash: string | null
  fileR2Key: string | null
  fileContent: string | null
}

export type RuntimeSkillRecord = SkillCatalogRecord

export type RuntimeSkillSummary<
  TRecord extends RuntimeSkillRecord = RuntimeSkillRecord,
> = {
  key: TRecord['skillSlug']
  id: TRecord['skillId']
  agentId: TRecord['agentId']
  name: TRecord['skillName']
  description: TRecord['skillDescription']
  enabled: TRecord['enabled']
  sourceUrl: TRecord['sourceUrl']
}

export type LoadedRuntimeSkill<
  TRecord extends RuntimeSkillRecord = RuntimeSkillRecord,
> = RuntimeSkillSummary<TRecord> & {
  body: TRecord['skillBody']
  bodyR2Key: TRecord['skillBodyR2Key']
  files: Array<{
    path: string
    contentHash: string | null
    r2Key: string | null
    content: string | null
  }>
}

export interface SkillCatalog {
  listAssignedSkills(input: {
    agentRuntimeName: string
  }): Promise<RuntimeSkillRecord[]>
  getAssignedSkill(input: {
    agentRuntimeName: string
    skillKey: string
  }): Promise<RuntimeSkillRecord[]>
}

export interface SkillWorkspace {
  writeFile(path: string, content: string): Promise<void>
}

export interface SkillFileStore {
  getText(key: string): Promise<string | null>
}

export class R2SkillFileStore implements SkillFileStore {
  constructor(private readonly bucket: R2Bucket) {}

  async getText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key)
    if (!object) return null

    return object.text()
  }
}

function brandRuntimeSkillId(value: string): RuntimeSkillId {
  return value as RuntimeSkillId
}

function brandRuntimeSkillSlug(value: string): RuntimeSkillSlug {
  return value as RuntimeSkillSlug
}

function brandRuntimeAgentId(value: string): RuntimeAgentId {
  return value as RuntimeAgentId
}

function toRuntimeSkillSummary<TRecord extends RuntimeSkillRecord>(
  record: TRecord,
): RuntimeSkillSummary<TRecord> {
  return {
    key: record.skillSlug,
    id: record.skillId,
    agentId: record.agentId,
    name: record.skillName,
    description: record.skillDescription,
    enabled: record.enabled,
    sourceUrl: record.sourceUrl,
  }
}

function toLoadedRuntimeSkill<TRecord extends RuntimeSkillRecord>(
  records: TRecord[],
): LoadedRuntimeSkill<TRecord> | null {
  const [head] = records
  if (!head) return null

  return {
    ...toRuntimeSkillSummary(head),
    body: head.skillBody,
    bodyR2Key: head.skillBodyR2Key,
    files: records.flatMap((record) =>
      record.filePath
        ? [
            {
              path: record.filePath,
              contentHash: record.fileContentHash,
              r2Key: record.fileR2Key,
              content: record.fileContent,
            },
          ]
        : [],
    ),
  }
}

function renderSkillInventoryLine<TRecord extends RuntimeSkillRecord>(
  record: TRecord,
) {
  const description = record.skillDescription?.trim()
  return `- ${record.skillSlug}${description ? `: ${description}` : ''}`
}

function renderLoadedSkillDocument<TRecord extends RuntimeSkillRecord>(input: {
  skill: LoadedRuntimeSkill<TRecord>
  mountRoot: string
  missingFiles: string[]
  files?: Array<{
    path: string
    contentHash: string | null
    r2Key: string | null
    content: string | null
  }>
}) {
  const fileLines = (input.files ?? input.skill.files).map(
    (file) => `- ${input.mountRoot}/${file.path}`,
  )
  const sections = [
    `# ${input.skill.name}`,
    `key: ${input.skill.key}`,
    `skill root: ${input.mountRoot}`,
    `entry file: ${input.mountRoot}/${SKILL_MD_FILENAME}`,
    'relative path rule: resolve skill-relative file references from the skill root above.',
    input.skill.sourceUrl ? `source: ${input.skill.sourceUrl}` : null,
    input.skill.description ? `description: ${input.skill.description}` : null,
    fileLines.length > 0 ? ['', 'Mounted supporting files:', ...fileLines] : [],
    input.missingFiles.length > 0
      ? [
          '',
          'Missing supporting files:',
          ...input.missingFiles.map((file) => `- ${file}`),
        ]
      : [],
    input.skill.body?.trim() ? ['', input.skill.body.trim()] : [],
  ]

  return flattenStringSections(sections).join('\n')
}

function flattenStringSections(
  sections: Array<string | string[] | null>,
): string[] {
  return sections.flatMap((section) => {
    if (typeof section === 'string') return [section]
    if (Array.isArray(section)) return section
    return []
  })
}

function createSkillDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

export class PostgresSkillCatalog implements SkillCatalog {
  private readonly db: ReturnType<typeof createSkillDb>

  constructor(databaseUrl: string) {
    this.db = createSkillDb(databaseUrl)
  }

  async listAssignedSkills(input: {
    agentRuntimeName: string
  }): Promise<RuntimeSkillRecord[]> {
    return this.queryAssignedSkills(input)
  }

  async getAssignedSkill(input: {
    agentRuntimeName: string
    skillKey: string
  }): Promise<RuntimeSkillRecord[]> {
    return this.queryAssignedSkills(input)
  }

  private async queryAssignedSkills(input: {
    agentRuntimeName: string
    skillKey?: string
  }): Promise<RuntimeSkillRecord[]> {
    const rows = await this.db
      .select({
        agentId: schema.agent.id,
        skillId: schema.skill.id,
        skillSlug: schema.skill.slug,
        skillName: schema.skill.name,
        skillDescription: schema.skill.description,
        skillBody: schema.skill.body,
        skillBodyR2Key: sql<string | null>`null`,
        sourceUrl: schema.skill.sourceUrl,
        enabled: schema.agentSkill.enabled,
        filePath: schema.skillFile.path,
        fileContentHash: schema.skillFile.contentHash,
        fileR2Key: schema.skillFile.r2Key,
      })
      .from(schema.agentSkill)
      .innerJoin(schema.agent, eq(schema.agent.id, schema.agentSkill.agentId))
      .innerJoin(schema.skill, eq(schema.skill.id, schema.agentSkill.skillId))
      .leftJoin(schema.skillFile, eq(schema.skillFile.skillId, schema.skill.id))
      .where(
        and(
          eq(schema.agent.hostName, input.agentRuntimeName),
          eq(schema.agentSkill.enabled, true),
          input.skillKey ? eq(schema.skill.slug, input.skillKey) : undefined,
        ),
      )
      .orderBy(asc(schema.skill.slug), asc(schema.skillFile.path))

    return rows.map((row) => ({
      agentId: brandRuntimeAgentId(row.agentId),
      skillId: brandRuntimeSkillId(row.skillId),
      skillSlug: brandRuntimeSkillSlug(row.skillSlug),
      skillName: row.skillName,
      skillDescription: row.skillDescription,
      skillBody: row.skillBody,
      skillBodyR2Key: row.skillBodyR2Key,
      sourceUrl: row.sourceUrl,
      enabled: row.enabled,
      filePath: row.filePath,
      fileContentHash: row.fileContentHash,
      fileR2Key: row.fileR2Key,
      fileContent: null,
    }))
  }
}

export class BuiltinSkillCatalog implements SkillCatalog {
  constructor(
    private readonly bundles: readonly BuiltinSkillManifest[] = DOC_BUILTIN_SKILLS,
  ) {}

  async listAssignedSkills(input: {
    agentRuntimeName: string
  }): Promise<RuntimeSkillRecord[]> {
    return this.bundles.flatMap((bundle) =>
      this.toSkillRows(input.agentRuntimeName, bundle),
    )
  }

  async getAssignedSkill(input: {
    agentRuntimeName: string
    skillKey: string
  }): Promise<RuntimeSkillRecord[]> {
    const bundle = this.bundles.find((entry) => entry.slug === input.skillKey)
    if (!bundle) return []

    return this.toSkillRows(input.agentRuntimeName, bundle)
  }

  private toSkillRows(
    agentRuntimeName: string,
    bundle: BuiltinSkillManifest,
  ): RuntimeSkillRecord[] {
    return [
      {
        agentId: brandRuntimeAgentId(`builtin:${agentRuntimeName}`),
        skillId: brandRuntimeSkillId(`builtin:${bundle.slug}`),
        skillSlug: brandRuntimeSkillSlug(bundle.slug),
        skillName: bundle.name,
        skillDescription: bundle.description,
        skillBody: bundle.body ?? null,
        skillBodyR2Key:
          bundle.bodyR2Key ??
          (bundle.body
            ? null
            : buildBuiltinSkillObjectKey({
                slug: bundle.slug,
                path: 'SKILL.md',
              })),
        sourceUrl: bundle.sourceUrl,
        enabled: true,
        filePath: null,
        fileContentHash: null,
        fileR2Key: null,
        fileContent: null,
      },
      ...(bundle.files ?? []).map((file) => ({
        agentId: brandRuntimeAgentId(`builtin:${agentRuntimeName}`),
        skillId: brandRuntimeSkillId(`builtin:${bundle.slug}`),
        skillSlug: brandRuntimeSkillSlug(bundle.slug),
        skillName: bundle.name,
        skillDescription: bundle.description,
        skillBody: bundle.body ?? null,
        skillBodyR2Key: bundle.bodyR2Key ?? null,
        sourceUrl: bundle.sourceUrl,
        enabled: true,
        filePath: file.path,
        fileContentHash: file.contentHash ?? null,
        fileR2Key:
          file.r2Key ??
          (file.content
            ? null
            : buildBuiltinSkillObjectKey({
                slug: bundle.slug,
                path: file.path,
              })),
        fileContent: file.content ?? null,
      })),
    ]
  }
}

export class MergedSkillCatalog implements SkillCatalog {
  constructor(private readonly catalogs: readonly SkillCatalog[]) {}

  async listAssignedSkills(input: {
    agentRuntimeName: string
  }): Promise<RuntimeSkillRecord[]> {
    const rowsByCatalog = await Promise.all(
      this.catalogs.map((catalog) => catalog.listAssignedSkills(input)),
    )

    return mergeCatalogRowsByPrecedence(rowsByCatalog)
  }

  async getAssignedSkill(input: {
    agentRuntimeName: string
    skillKey: string
  }): Promise<RuntimeSkillRecord[]> {
    for (let index = this.catalogs.length - 1; index >= 0; index -= 1) {
      const catalog = this.catalogs[index]
      if (!catalog) continue

      const rows = await catalog.getAssignedSkill(input)
      if (rows.length > 0) return rows
    }

    return []
  }
}

/**
 * Bridges Garden's skill catalog into Think's SkillProvider interface. The
 * provider exists because Garden skills are more than one flat R2 object:
 * repo-bundled built-ins may carry raw supporting files, while workspace skills
 * are assigned in Postgres and may point at large R2-backed utilities. Loading a
 * skill materializes SKILL.md plus supporting files into the agent workspace so
 * relative references keep working.
 */
export class GardenSkillProvider<
  TCatalog extends SkillCatalog = SkillCatalog,
> implements SkillProvider {
  constructor(
    private readonly catalog: TCatalog,
    private readonly input: {
      agentRuntimeName: string
      workspace: SkillWorkspace
      fileStore: SkillFileStore
    },
  ) {}

  async get(): Promise<string | null> {
    const assignedSkills = await this.catalog.listAssignedSkills(this.input)
    const uniqueSkills = dedupeSkillRows(assignedSkills)
    if (uniqueSkills.length === 0) return null

    return uniqueSkills.map(renderSkillInventoryLine).join('\n')
  }

  async load(key: string): Promise<string | null> {
    const rows = await this.catalog.getAssignedSkill({
      agentRuntimeName: this.input.agentRuntimeName,
      skillKey: key,
    })
    const skill = toLoadedRuntimeSkill(rows)
    if (!skill) return null

    const mountRoot = buildSkillMountRoot(skill.key)
    const materialized = await materializeLoadedSkill({
      skill,
      mountRoot,
      workspace: this.input.workspace,
      fileStore: this.input.fileStore,
    })

    return renderLoadedSkillDocument({
      skill,
      mountRoot,
      missingFiles: materialized.missingFiles,
      files: materialized.files,
    })
  }
}

async function materializeLoadedSkill<
  TRecord extends RuntimeSkillRecord,
>(input: {
  skill: LoadedRuntimeSkill<TRecord>
  mountRoot: string
  workspace: SkillWorkspace
  fileStore: SkillFileStore
}) {
  const resolvedFiles = input.skill.files
  const skillBody =
    input.skill.body ??
    (input.skill.bodyR2Key
      ? await input.fileStore.getText(input.skill.bodyR2Key)
      : null)
  if (skillBody === null) {
    return {
      files: resolvedFiles,
      missingFiles: [SKILL_MD_FILENAME],
    }
  }

  await input.workspace.writeFile(
    `${input.mountRoot}/${SKILL_MD_FILENAME}`,
    skillBody,
  )

  const fileResults = await Promise.all(
    resolvedFiles.map(async (file) => {
      const content =
        file.content ??
        (file.r2Key ? await input.fileStore.getText(file.r2Key) : null)
      if (content === null) return file.path

      await input.workspace.writeFile(
        `${input.mountRoot}/${file.path}`,
        content,
      )
      return null
    }),
  )

  return {
    files: resolvedFiles,
    missingFiles: fileResults.flatMap((result) => (result ? [result] : [])),
  }
}

function dedupeSkillRows<TRecord extends RuntimeSkillRecord>(
  records: TRecord[],
) {
  const bySlug = new Map<string, TRecord>()
  for (const record of records) {
    if (!bySlug.has(record.skillSlug)) {
      bySlug.set(record.skillSlug, record)
    }
  }

  return Array.from(bySlug.values())
}

function mergeCatalogRowsByPrecedence<TRecord extends RuntimeSkillRecord>(
  rowsByCatalog: readonly (readonly TRecord[])[],
) {
  const bySlug = new Map<string, TRecord[]>()

  for (let index = rowsByCatalog.length - 1; index >= 0; index -= 1) {
    const rows = rowsByCatalog[index]
    if (!rows) continue

    const grouped = new Map<string, TRecord[]>()
    for (const row of rows) {
      const group = grouped.get(row.skillSlug)
      if (group) group.push(row)
      else grouped.set(row.skillSlug, [row])
    }

    for (const [slug, groupedRows] of grouped) {
      if (!bySlug.has(slug)) {
        bySlug.set(slug, groupedRows)
      }
    }
  }

  return Array.from(bySlug.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, rows]) => rows)
}

function buildSkillMountRoot(skillSlug: string) {
  const normalizedSlug = skillSlug
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return `${SKILL_MOUNT_ROOT}/${normalizedSlug || 'skill'}`
}

export { buildBuiltinSkillObjectKey }

/**
 * Creates the runtime skill provider used by chat and automation agents. It
 * merges always-available built-in bundles with DB-assigned workspace skills,
 * then lets Think expose them through load_context/unload_context.
 */
export function createGardenSkillProvider(input: {
  agentRuntimeName: string
  databaseUrl: string
  workspace: SkillWorkspace
  fileStore: SkillFileStore
}) {
  return new GardenSkillProvider(
    new MergedSkillCatalog([
      new BuiltinSkillCatalog(),
      new PostgresSkillCatalog(input.databaseUrl),
    ]),
    {
      agentRuntimeName: input.agentRuntimeName,
      workspace: input.workspace,
      fileStore: input.fileStore,
    },
  )
}

/**
 * Mounts all currently available Garden skills into the workspace without
 * waiting for an explicit load_context call. Used when the UI/runtime needs the
 * files present for non-chat flows while preserving the same catalog semantics.
 */
export async function materializeGardenSkills(input: {
  agentRuntimeName: string
  databaseUrl: string
  workspace: SkillWorkspace
  fileStore: SkillFileStore
}) {
  return materializeSkillCatalog({
    agentRuntimeName: input.agentRuntimeName,
    catalog: new MergedSkillCatalog([
      new BuiltinSkillCatalog(),
      new PostgresSkillCatalog(input.databaseUrl),
    ]),
    workspace: input.workspace,
    fileStore: input.fileStore,
  })
}

export async function materializeSkillCatalog(input: {
  agentRuntimeName: string
  catalog: SkillCatalog
  workspace: SkillWorkspace
  fileStore: SkillFileStore
}) {
  const provider = new GardenSkillProvider(input.catalog, {
    agentRuntimeName: input.agentRuntimeName,
    workspace: input.workspace,
    fileStore: input.fileStore,
  })
  const assignedSkills = await input.catalog.listAssignedSkills({
    agentRuntimeName: input.agentRuntimeName,
  })
  const uniqueSkills = dedupeSkillRows(assignedSkills)

  await Promise.all(uniqueSkills.map((skill) => provider.load(skill.skillSlug)))

  return uniqueSkills.map((skill) => skill.skillSlug)
}
