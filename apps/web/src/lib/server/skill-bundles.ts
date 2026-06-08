import { Result, TaggedError } from 'better-result'
import type * as schema from '@garden/db/schema'
import { hashTextHex } from '@/lib/server/skills-sh'

type SkillFileRow = typeof schema.skillFile.$inferSelect

export class SkillRuntimeBundleStorageError extends TaggedError(
  'SkillRuntimeBundleStorageError',
)<{
  message: string
  path: string
  phase: 'put' | 'delete'
  slug: string
  workspaceId: string
}>() {}

export type SkillBundleFileInput = {
  path: string
  content: string
}

export function parseSkillBundleFiles(value: unknown): SkillBundleFileInput[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((file) => {
    if (
      typeof file !== 'object' ||
      file === null ||
      typeof file.path !== 'string' ||
      typeof file.content !== 'string'
    ) {
      return []
    }

    const path = file.path.trim().replace(/\\/g, '/')
    if (!path || path.startsWith('/')) return []
    if (path.split('/').some((segment: string) => segment === '..')) return []
    if (path.toLowerCase() === 'skill.md') return []

    return [{ path, content: file.content }]
  })
}

export type StoredSkillBundleFile = {
  id: string
  skillId: string
  path: string
  contentHash: string
  r2Key: string
}

export async function hashSkillBundle(input: {
  content: string
  files: SkillBundleFileInput[]
}) {
  const sortedFiles = [...input.files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  const serialized = [
    input.content,
    ...sortedFiles.map((file) => `${file.path}\n${file.content}`),
  ].join('\n---\n')

  return hashTextHex(serialized)
}

const WORKSPACE_SKILL_R2_PREFIX = 'agent-skills/workspaces'
const AGENT_SKILL_R2_PREFIX = 'agent-skills/agents'

function workspaceSkillRuntimeKey(input: {
  workspaceId: string
  slug: string
  path: string
}) {
  return [
    WORKSPACE_SKILL_R2_PREFIX,
    input.workspaceId,
    input.slug,
    input.path,
  ].join('/')
}

function agentSkillRuntimePrefix(agentId: string) {
  return `${AGENT_SKILL_R2_PREFIX}/${agentId}/`
}

function agentSkillRuntimeKey(input: {
  agentId: string
  slug: string
  path: string
}) {
  return [AGENT_SKILL_R2_PREFIX, input.agentId, input.slug, input.path].join(
    '/',
  )
}

/**
 * Mirrors a workspace skill into the standard Agent Skills directory layout that
 * the SDK `agents/skills` R2 source reads directly. Before this mirror, Garden
 * had to adapt DB rows and fan out runtime refreshes after every write. After
 * this mirror, runtime agents can simply return `skills.r2(...)` and let Think
 * activate skills/resources lazily.
 */
export async function persistRuntimeSkillBundle(input: {
  bucket: R2Bucket
  workspaceId: string
  slug: string
  content: string
  files: SkillBundleFileInput[]
}) {
  const entryResult = await putRuntimeSkillObject({
    ...input,
    path: 'SKILL.md',
    content: input.content,
    contentType: 'text/markdown; charset=utf-8',
  })
  if (entryResult.isErr()) return entryResult

  for (const file of input.files) {
    const fileResult = await putRuntimeSkillObject({
      ...input,
      path: file.path,
      content: file.content,
      contentType: inferContentType(file.path),
    })
    if (fileResult.isErr()) return fileResult
  }

  return Result.ok(undefined)
}

export async function replaceAgentRuntimeSkillBundles(input: {
  bucket: R2Bucket
  agentId: string
  workspaceId: string
  skills: Array<{ slug: string; files: Array<{ path: string }> }>
}) {
  const deleteResult = await deleteR2Prefix({
    bucket: input.bucket,
    prefix: agentSkillRuntimePrefix(input.agentId),
  })
  if (deleteResult.isErr()) return deleteResult

  for (const skill of input.skills) {
    const copyEntryResult = await copyRuntimeSkillObject({
      bucket: input.bucket,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      slug: skill.slug,
      path: 'SKILL.md',
    })
    if (copyEntryResult.isErr()) return copyEntryResult

    for (const file of skill.files) {
      const copyFileResult = await copyRuntimeSkillObject({
        bucket: input.bucket,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        slug: skill.slug,
        path: file.path,
      })
      if (copyFileResult.isErr()) return copyFileResult
    }
  }

  return Result.ok(undefined)
}

export async function deleteRuntimeSkillBundle(input: {
  bucket: R2Bucket
  workspaceId: string
  slug: string
  files: Array<{ path: string }>
}) {
  for (const path of ['SKILL.md', ...input.files.map((file) => file.path)]) {
    const deleteResult = await Result.tryPromise({
      try: async () =>
        await input.bucket.delete(
          workspaceSkillRuntimeKey({
            workspaceId: input.workspaceId,
            slug: input.slug,
            path,
          }),
        ),
      catch: (cause) =>
        new SkillRuntimeBundleStorageError({
          message: cause instanceof Error ? cause.message : String(cause),
          phase: 'delete',
          path,
          slug: input.slug,
          workspaceId: input.workspaceId,
        }),
    })
    if (deleteResult.isErr()) return deleteResult
  }

  return Result.ok(undefined)
}

function copyRuntimeSkillObject(input: {
  bucket: R2Bucket
  workspaceId: string
  agentId: string
  slug: string
  path: string
}) {
  return Result.tryPromise({
    try: async () => {
      const sourceKey = workspaceSkillRuntimeKey({
        workspaceId: input.workspaceId,
        slug: input.slug,
        path: input.path,
      })
      const object = await input.bucket.get(sourceKey)
      if (!object) return

      await input.bucket.put(
        agentSkillRuntimeKey({
          agentId: input.agentId,
          slug: input.slug,
          path: input.path,
        }),
        object.body,
        {
          httpMetadata: object.httpMetadata,
          customMetadata: object.customMetadata,
        },
      )
    },
    catch: (cause) =>
      new SkillRuntimeBundleStorageError({
        message: cause instanceof Error ? cause.message : String(cause),
        phase: 'put',
        path: input.path,
        slug: input.slug,
        workspaceId: input.workspaceId,
      }),
  })
}

function deleteR2Prefix(input: { bucket: R2Bucket; prefix: string }) {
  return Result.tryPromise({
    try: async () => {
      let cursor: string | undefined
      do {
        const listed = await input.bucket.list({
          prefix: input.prefix,
          cursor,
        })
        for (const object of listed.objects) {
          await input.bucket.delete(object.key)
        }
        cursor = listed.truncated ? listed.cursor : undefined
      } while (cursor)
    },
    catch: (cause) =>
      new SkillRuntimeBundleStorageError({
        message: cause instanceof Error ? cause.message : String(cause),
        phase: 'delete',
        path: input.prefix,
        slug: '*',
        workspaceId: '*',
      }),
  })
}

function putRuntimeSkillObject(input: {
  bucket: R2Bucket
  workspaceId: string
  slug: string
  path: string
  content: string
  contentType: string
}) {
  return Result.tryPromise({
    try: async () =>
      await input.bucket.put(
        workspaceSkillRuntimeKey({
          workspaceId: input.workspaceId,
          slug: input.slug,
          path: input.path,
        }),
        input.content,
        { httpMetadata: { contentType: input.contentType } },
      ),
    catch: (cause) =>
      new SkillRuntimeBundleStorageError({
        message: cause instanceof Error ? cause.message : String(cause),
        phase: 'put',
        path: input.path,
        slug: input.slug,
        workspaceId: input.workspaceId,
      }),
  })
}

export async function persistSkillBundleFiles(input: {
  bucket: R2Bucket
  workspaceId: string
  skillId: string
  bundleHash: string
  files: SkillBundleFileInput[]
}): Promise<StoredSkillBundleFile[]> {
  return Promise.all(
    input.files.map(async (file) => {
      const contentHash = await hashTextHex(file.content)
      const r2Key = buildSkillBundleR2Key({
        workspaceId: input.workspaceId,
        skillId: input.skillId,
        bundleHash: input.bundleHash,
        path: file.path,
      })

      await input.bucket.put(r2Key, file.content, {
        httpMetadata: {
          contentType: inferContentType(file.path),
        },
      })

      return {
        id: crypto.randomUUID(),
        skillId: input.skillId,
        path: file.path,
        contentHash,
        r2Key,
      }
    }),
  )
}

export async function loadSkillBundleFiles(
  bucket: R2Bucket,
  files: SkillFileRow[],
) {
  const loadedFiles = await Promise.all(
    files.map(async (file) => {
      if (!file.r2Key) return null

      const object = await bucket.get(file.r2Key)
      if (!object) return null

      return {
        id: file.id,
        skill_id: file.skillId,
        path: file.path,
        content: await object.text(),
        content_hash: file.contentHash ?? null,
        r2_key: file.r2Key,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }),
  )

  return loadedFiles.filter(
    (file): file is NonNullable<(typeof loadedFiles)[number]> => Boolean(file),
  )
}

export async function deleteSkillBundleFiles(
  bucket: R2Bucket,
  files: SkillFileRow[],
) {
  const keys = files.flatMap((file) => (file.r2Key ? [file.r2Key] : []))
  if (keys.length === 0) return

  await bucket.delete(keys)
}

function buildSkillBundleR2Key(input: {
  workspaceId: string
  skillId: string
  bundleHash: string
  path: string
}) {
  return [
    'skills',
    input.workspaceId,
    input.skillId,
    input.bundleHash,
    input.path,
  ].join('/')
}

function inferContentType(path: string) {
  const lowerPath = path.toLowerCase()

  if (lowerPath.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (lowerPath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lowerPath.endsWith('.ts')) return 'text/plain; charset=utf-8'
  if (lowerPath.endsWith('.tsx')) return 'text/plain; charset=utf-8'
  if (lowerPath.endsWith('.js')) return 'text/plain; charset=utf-8'
  if (lowerPath.endsWith('.jsx')) return 'text/plain; charset=utf-8'
  if (lowerPath.endsWith('.py')) return 'text/plain; charset=utf-8'
  if (lowerPath.endsWith('.sh')) return 'text/x-shellscript; charset=utf-8'
  if (lowerPath.endsWith('.txt')) return 'text/plain; charset=utf-8'
  if (lowerPath.endsWith('.svg')) return 'image/svg+xml'

  return 'application/octet-stream'
}
