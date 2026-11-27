import type { AgentPermissions } from '@garden/core/agents/permissions'
import { DOC_BUILTIN_SKILLS } from './bundled-skills'
import type { SkillSource } from 'agents/skills'

export function isSkillAllowedBySlugs(
  row: { readonly name: string; readonly slug?: string },
  allowed: ReadonlySet<string>,
): boolean {
  if (row.slug !== undefined) {
    return allowed.has(row.slug.toLowerCase())
  }
  return allowed.has(row.name.toLowerCase())
}

export function filterSkillRowsByAllowedSlugs<
  T extends { readonly name: string; readonly slug?: string },
>(rows: readonly T[], allowedSlugs: readonly string[] | null): T[] {
  if (!allowedSlugs) return [...rows]
  const allowed = new Set(allowedSlugs.map((entry) => entry.toLowerCase()))
  return rows.filter((row) => isSkillAllowedBySlugs(row, allowed))
}

export function allowedSlugsForPermissions(
  permissions: AgentPermissions | null,
): readonly string[] | null {
  if (!permissions || permissions.full_access) return null
  return permissions.allowed_skills
}

export function filterBuiltinSkillSource(
  source: SkillSource,
  permissions: AgentPermissions | null,
): SkillSource {
  const allowedSlugs = allowedSlugsForPermissions(permissions)
  if (!allowedSlugs) return source
  const allowed = new Set(allowedSlugs.map((entry) => entry.toLowerCase()))
  const slugByName = new Map(
    DOC_BUILTIN_SKILLS.map((manifest) => [
      manifest.name.toLowerCase(),
      manifest.slug.toLowerCase(),
    ]),
  )
  const allowedName = (name: string) => {
    const normalized = name.toLowerCase()
    if (allowed.has(normalized)) return true
    const slug = slugByName.get(normalized)
    return slug !== undefined && allowed.has(slug)
  }
  return {
    ...source,
    list: async () =>
      (await source.list()).filter((descriptor) =>
        allowedName(descriptor.name),
      ),
    load: async (name: string) =>
      allowedName(name) ? source.load(name) : null,
    ...(source.readResource
      ? {
          readResource: async (name: string, path: string) =>
            allowedName(name) && source.readResource
              ? source.readResource(name, path)
              : null,
        }
      : {}),
  }
}
