export const SKILL_MD = 'SKILL.md'

export function fileParentDir(path: string) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function fileBasename(path: string) {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

export function joinFilePath(dir: string, name: string) {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, '')
  return dir ? `${dir}/${trimmed}` : trimmed
}

export function rewriteFilePath(path: string, from: string, to: string) {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

export function isProtectedSkillPath(path: string) {
  return path === SKILL_MD
}

export function renameCollides(
  paths: readonly string[],
  from: string,
  to: string,
) {
  if (isProtectedSkillPath(to)) return true
  const unaffected = paths.filter(
    (path) => path !== from && !path.startsWith(`${from}/`),
  )
  const next = paths
    .filter((path) => path === from || path.startsWith(`${from}/`))
    .map((path) => rewriteFilePath(path, from, to))
  return next.some(
    (path) => isProtectedSkillPath(path) || unaffected.includes(path),
  )
}

export function isValidRenameName(name: string) {
  const trimmed = name.trim()
  return (
    trimmed.length > 0 &&
    !trimmed.includes('/') &&
    trimmed !== '.' &&
    trimmed !== '..'
  )
}
