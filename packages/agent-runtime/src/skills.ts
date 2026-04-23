import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { SkillProvider } from 'agents/experimental/memory/session'
import * as schema from '@garden/db/schema'

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
  sourceUrl: string | null
  bundleHash: string | null
  enabled: boolean
  filePath: string | null
  fileContentHash: string | null
  fileR2Key: string | null
}

export type RuntimeSkillRecord = SkillCatalogRecord

export type RuntimeSkillSummary<TRecord extends RuntimeSkillRecord = RuntimeSkillRecord> =
  {
    key: TRecord['skillSlug']
    id: TRecord['skillId']
    agentId: TRecord['agentId']
    name: TRecord['skillName']
    description: TRecord['skillDescription']
    enabled: TRecord['enabled']
    sourceUrl: TRecord['sourceUrl']
  }

export type LoadedRuntimeSkill<TRecord extends RuntimeSkillRecord = RuntimeSkillRecord> =
  RuntimeSkillSummary<TRecord> & {
    body: TRecord['skillBody']
    bundleHash: TRecord['bundleHash']
    files: Array<{
      path: string
      contentHash: string | null
      r2Key: string | null
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

export interface SkillBundleStore {
  getText(key: string): Promise<string | null>
}

export class R2SkillBundleStore implements SkillBundleStore {
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
    bundleHash: head.bundleHash,
    files: records.flatMap((record) =>
      record.filePath
        ? [
            {
              path: record.filePath,
              contentHash: record.fileContentHash,
              r2Key: record.fileR2Key,
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
}) {
  const fileLines = input.skill.files.map(
    (file) => `- ${input.mountRoot}/${file.path}`,
  )
  const sections = [
    `# ${input.skill.name}`,
    `key: ${input.skill.key}`,
    `skill root: ${input.mountRoot}`,
    `entry file: ${input.mountRoot}/${SKILL_MD_FILENAME}`,
    'relative path rule: resolve skill-relative file references from the skill root above.',
    input.skill.sourceUrl ? `source: ${input.skill.sourceUrl}` : null,
    input.skill.bundleHash ? `bundle hash: ${input.skill.bundleHash}` : null,
    input.skill.description ? `description: ${input.skill.description}` : null,
    fileLines.length > 0 ? ['', 'Mounted supporting files:', ...fileLines] : [],
    input.missingFiles.length > 0
      ? ['', 'Missing supporting files:', ...input.missingFiles.map((file) => `- ${file}`)]
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
        sourceUrl: schema.skill.sourceUrl,
        bundleHash: schema.skill.bundleHash,
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
          eq(schema.agent.doId, input.agentRuntimeName),
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
      sourceUrl: row.sourceUrl,
      bundleHash: row.bundleHash,
      enabled: row.enabled,
      filePath: row.filePath,
      fileContentHash: row.fileContentHash,
      fileR2Key: row.fileR2Key,
    }))
  }
}

export class AssignedSkillProvider<TCatalog extends SkillCatalog = SkillCatalog>
  implements SkillProvider
{
  constructor(
    private readonly catalog: TCatalog,
    private readonly input: {
      agentRuntimeName: string
      workspace: SkillWorkspace
      bundleStore: SkillBundleStore
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
    if (!skill?.body) return null

    const mountRoot = buildSkillMountRoot(skill.key)
    const missingFiles = await materializeLoadedSkill({
      skill,
      mountRoot,
      workspace: this.input.workspace,
      bundleStore: this.input.bundleStore,
    })

    return renderLoadedSkillDocument({
      skill,
      mountRoot,
      missingFiles,
    })
  }
}

async function materializeLoadedSkill<TRecord extends RuntimeSkillRecord>(input: {
  skill: LoadedRuntimeSkill<TRecord>
  mountRoot: string
  workspace: SkillWorkspace
  bundleStore: SkillBundleStore
}) {
  await input.workspace.writeFile(
    `${input.mountRoot}/${SKILL_MD_FILENAME}`,
    input.skill.body ?? '',
  )

  const fileResults = await Promise.all(
    input.skill.files.map(async (file) => {
      if (!file.r2Key) return file.path

      const content = await input.bundleStore.getText(file.r2Key)
      if (content === null) return file.path

      await input.workspace.writeFile(`${input.mountRoot}/${file.path}`, content)
      return null
    }),
  )

  return fileResults.flatMap((result) => (result ? [result] : []))
}

function dedupeSkillRows<TRecord extends RuntimeSkillRecord>(records: TRecord[]) {
  const bySlug = new Map<string, TRecord>()
  for (const record of records) {
    if (!bySlug.has(record.skillSlug)) {
      bySlug.set(record.skillSlug, record)
    }
  }

  return Array.from(bySlug.values())
}

function buildSkillMountRoot(skillSlug: string) {
  const normalizedSlug = skillSlug
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return `${SKILL_MOUNT_ROOT}/${normalizedSlug || 'skill'}`
}

export function createAssignedSkillProvider(input: {
  agentRuntimeName: string
  databaseUrl: string
  workspace: SkillWorkspace
  bundleStore: SkillBundleStore
}) {
  return new AssignedSkillProvider(
    new PostgresSkillCatalog(input.databaseUrl),
    {
      agentRuntimeName: input.agentRuntimeName,
      workspace: input.workspace,
      bundleStore: input.bundleStore,
    },
  )
}
