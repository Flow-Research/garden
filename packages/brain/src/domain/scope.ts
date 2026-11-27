import { Schema } from 'effect'

export const OrgScope = Schema.Struct({ kind: Schema.Literal('org') })
export const TeamScope = Schema.Struct({
  kind: Schema.Literal('team'),
  teamId: Schema.String,
})
export const UserScope = Schema.Struct({
  kind: Schema.Literal('user'),
  userId: Schema.String,
})

export const BrainScope = Schema.Union([OrgScope, TeamScope, UserScope])
export type BrainScope = typeof BrainScope.Type

export const orgScope = (): BrainScope => ({ kind: 'org' })

export const teamScope = (teamId: string): BrainScope => ({
  kind: 'team',
  teamId,
})

export const userScope = (userId: string): BrainScope => ({
  kind: 'user',
  userId,
})

export type ScopeViewer = {
  readonly teamIds: ReadonlySet<string>
  readonly userId: string | undefined
}

export const canViewScope = (
  scope: BrainScope,
  viewer: ScopeViewer,
): boolean => {
  switch (scope.kind) {
    case 'org':
      return true
    case 'team':
      return viewer.teamIds.has(scope.teamId)
    case 'user':
      return viewer.userId !== undefined && viewer.userId === scope.userId
  }
}

export const scopeKey = (scope: BrainScope): string => {
  switch (scope.kind) {
    case 'org':
      return 'org'
    case 'team':
      return `team:${scope.teamId}`
    case 'user':
      return `user:${scope.userId}`
  }
}

export const narrowestScope = (
  scopes: readonly BrainScope[],
): BrainScope | undefined => {
  const [head] = scopes
  if (head === undefined) return undefined
  const restricted = scopes.filter((scope) => scope.kind !== 'org')
  const [first, ...rest] = restricted
  if (first === undefined) return orgScope()
  const firstKey = scopeKey(first)
  return rest.every((scope) => scopeKey(scope) === firstKey) ? first : undefined
}
