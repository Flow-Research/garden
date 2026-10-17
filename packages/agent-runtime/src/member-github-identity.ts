/**
 * Agent-facing GitHub identity for a workspace member. Prefer github user_id
 * as the stable key; login can rename (refreshed in a later phase). Both null
 * (or a half-pair) is explicit not_linked — never invent a handle.
 */
export type MemberGithubIdentity =
  | { status: 'linked'; user_id: string; login: string }
  | { status: 'not_linked' }

export function memberGithubIdentity(args: {
  githubUserId: string | null
  githubLogin: string | null
}): MemberGithubIdentity {
  if (args.githubUserId !== null && args.githubLogin !== null) {
    return {
      status: 'linked',
      user_id: args.githubUserId,
      login: args.githubLogin,
    }
  }
  return { status: 'not_linked' }
}
