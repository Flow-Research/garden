/**
 * Picks where to land after switching workspace from the current page.
 *
 * Section pages stay put. A route with a `$param` segment names an entity of
 * the old workspace, so it falls back to the section above that segment
 * (`/agents/$agentId` → `/agents`); a splat (`$`) is not an entity id. Search
 * params are dropped because they also carry entity ids (`?team=`, `?focus=`).
 */
export function workspaceSwitchTarget(
  routeFullPath: string,
  pathname: string,
): string {
  const segments = routeFullPath.split('/').filter(Boolean)
  const entityIndex = segments.findIndex(
    (segment) => segment.startsWith('$') && segment !== '$',
  )
  if (entityIndex === -1) return pathname
  if (entityIndex === 0) return '/home'
  return `/${segments.slice(0, entityIndex).join('/')}`
}
