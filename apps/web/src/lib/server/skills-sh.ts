import type { SkillsShSearchResult } from '@garden/core/types'

const SKILLS_SH_ORIGIN = 'https://skills.sh'
const SKILLS_SH_SEARCH_PATH = '/api/search'
const SKILLS_SH_DOWNLOAD_PATH = '/api/download'
const SKILL_MD_PATH = 'SKILL.md'
// TODO(skills): add a `GITHUB_TOKEN` worker secret/binding and plumb it through
// the import path for higher GitHub API headroom. The skills.sh/skills CLI
// ecosystem leans on GitHub repo/tree discovery before falling back.

export type SkillsShSkillRef = {
  owner: string
  repo: string
  skill: string
  source: string
  canonicalUrl: string
}

type SkillsShSearchResponse = {
  skills?: Array<{
    id?: unknown
    skillId?: unknown
    name?: unknown
    installs?: unknown
    source?: unknown
  }>
}

export type SkillsShDownloadFile = {
  path: string
  contents: string
}

type SkillsShDownloadResponse = {
  files?: Array<{
    path?: unknown
    contents?: unknown
  }>
  hash?: unknown
}

export type ImportedSkillBundleDraft = {
  sourceType: 'skills.sh'
  sourceUrl: string
  bundleHash: string
  slug: string
  name: string
  description: string
  content: string
  config: Record<string, unknown>
  files: SkillsShDownloadFile[]
}

export function parseSkillsShSkillRef(
  input: string,
): SkillsShSkillRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (URL.canParse(trimmed)) {
    const parsed = new URL(trimmed)
    if (parsed.hostname !== 'skills.sh') return null

    const segments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    if (segments.length < 3) return null

    const [owner, repo, skill] = segments
    if (!owner || !repo || !skill) return null

    return {
      owner,
      repo,
      skill,
      source: `${owner}/${repo}`,
      canonicalUrl: `${SKILLS_SH_ORIGIN}/${owner}/${repo}/${skill}`,
    }
  }

  const segments = trimmed
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length !== 3) return null

  const [owner, repo, skill] = segments
  if (!owner || !repo || !skill) return null

  return {
    owner,
    repo,
    skill,
    source: `${owner}/${repo}`,
    canonicalUrl: `${SKILLS_SH_ORIGIN}/${owner}/${repo}/${skill}`,
  }
}

export async function searchSkillsSh(
  query: string,
  limit = 10,
): Promise<SkillsShSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const url = new URL(SKILLS_SH_SEARCH_PATH, SKILLS_SH_ORIGIN)
  url.searchParams.set('q', trimmedQuery)
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 25))))

  const response = await fetch(url).catch(() => null)
  if (!response?.ok) return []

  const payload = (await response.json().catch(() => null)) as
    | SkillsShSearchResponse
    | null
  if (!payload?.skills || !Array.isArray(payload.skills)) return []

  return payload.skills.flatMap((skill) => {
    if (
      typeof skill.id !== 'string' ||
      typeof skill.skillId !== 'string' ||
      typeof skill.name !== 'string' ||
      typeof skill.source !== 'string'
    ) {
      return []
    }

    return [
      {
        id: skill.id,
        skill_id: skill.skillId,
        name: skill.name,
        installs:
          typeof skill.installs === 'number' && Number.isFinite(skill.installs)
            ? skill.installs
            : 0,
        source: skill.source,
      },
    ]
  })
}

export async function downloadSkillsShBundle(
  ref: SkillsShSkillRef,
): Promise<ImportedSkillBundleDraft | Response> {
  const url = new URL(
    `${SKILLS_SH_DOWNLOAD_PATH}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${encodeURIComponent(ref.skill)}`,
    SKILLS_SH_ORIGIN,
  )
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) {
    return jsonError('Unable to download skill bundle from skills.sh')
  }

  const payload = (await response.json().catch(() => null)) as
    | SkillsShDownloadResponse
    | null
  if (!payload?.files || !Array.isArray(payload.files)) {
    return jsonError('skills.sh returned an invalid skill bundle')
  }

  const bundleHash =
    typeof payload.hash === 'string' && payload.hash.trim()
      ? payload.hash.trim()
      : null
  if (!bundleHash) {
    return jsonError('skills.sh bundle hash is missing')
  }

  const normalizedFiles = payload.files.flatMap((file) => {
    if (typeof file.path !== 'string' || typeof file.contents !== 'string') {
      return []
    }

    const normalizedPath = normalizeSkillBundlePath(file.path)
    if (!normalizedPath) return []

    return [{ path: normalizedPath, contents: file.contents }]
  })

  const skillDocument = normalizedFiles.find(
    (file) => file.path.toLowerCase() === SKILL_MD_PATH.toLowerCase(),
  )
  if (!skillDocument) {
    return jsonError('skills.sh bundle is missing SKILL.md')
  }

  const parsedDocument = parseSkillDocument(skillDocument.contents)

  return {
    sourceType: 'skills.sh',
    sourceUrl: ref.canonicalUrl,
    bundleHash,
    slug: ref.skill,
    name: parsedDocument.name || ref.skill,
    description: parsedDocument.description || '',
    content: skillDocument.contents,
    config: {
      import: {
        provider: 'skills.sh',
        owner: ref.owner,
        repo: ref.repo,
        skill: ref.skill,
        source: ref.source,
      },
      frontmatter_raw: parsedDocument.frontmatterRaw,
    },
    files: normalizedFiles.filter(
      (file) => file.path.toLowerCase() !== SKILL_MD_PATH.toLowerCase(),
    ),
  }
}

export async function hashTextHex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function normalizeSkillBundlePath(path: string) {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/')) return null

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (segments.some((segment) => segment === '..')) return null

  return segments.join('/')
}

function parseSkillDocument(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const frontmatterRaw = match?.[1]?.trim() ?? ''

  return {
    frontmatterRaw,
    name: extractFrontmatterField(frontmatterRaw, 'name'),
    description: extractFrontmatterField(frontmatterRaw, 'description'),
  }
}

function extractFrontmatterField(frontmatter: string, key: string) {
  if (!frontmatter) return null

  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'm')
  const value = frontmatter.match(pattern)?.[1]?.trim()
  if (!value) return null

  return value.replace(/^['"]|['"]$/g, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jsonError(message: string) {
  return Response.json({ error: message }, { status: 400 })
}
