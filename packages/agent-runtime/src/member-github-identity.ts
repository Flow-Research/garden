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

export type GithubAssigneeCheck =
  | { status: 'allowed' }
  | { status: 'unlinked'; logins: string[]; message: string }

/**
 * Gate for issue_write.assignees. Before: the tool accepted any string, so
 * "never invent a handle" was only a prompt rule and an agent could assign a
 * stranger. Now every requested login must belong to a linked member of the
 * calling workspace. GitHub logins are case-insensitive, so compare lowered.
 */
export function checkGithubIssueAssignees(args: {
  requested: readonly string[]
  linkedLogins: readonly string[]
}): GithubAssigneeCheck {
  const linked = new Set(args.linkedLogins.map((login) => login.toLowerCase()))
  const unlinked = args.requested.filter(
    (login) => !linked.has(login.toLowerCase()),
  )
  if (unlinked.length === 0) return { status: 'allowed' }
  return {
    status: 'unlinked',
    logins: unlinked,
    message: `GitHub login not linked to a member of this workspace: ${unlinked.join(', ')}. Link the member's GitHub identity in workspace settings, or leave the issue unassigned.`,
  }
}
