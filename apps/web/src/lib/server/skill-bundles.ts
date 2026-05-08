import type * as schema from '@garden/db/schema'
import { hashTextHex } from '@/lib/server/skills-sh'

type SkillFileRow = typeof schema.skillFile.$inferSelect

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
