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

export type GithubAssigneeCandidate = {
  /** Display label for errors (name, email, or membership id). */
  label: string
  github_identity: MemberGithubIdentity
}

export type ResolveGithubAssigneesResult =
  | { ok: true; assignees: string[] }
  | {
      ok: false
      status: 'not_linked'
      not_linked: string[]
      message: string
    }

/**
 * Builds GitHub issue_write.assignees from inventory github_identity values.
 * Any not_linked member fails the whole resolution — never invent handles.
 */
export function resolveGithubIssueAssignees(
  candidates: readonly GithubAssigneeCandidate[],
): ResolveGithubAssigneesResult {
  const assignees: string[] = []
  const notLinked: string[] = []

  for (const candidate of candidates) {
    if (candidate.github_identity.status === 'linked') {
      assignees.push(candidate.github_identity.login)
    } else {
      notLinked.push(candidate.label)
    }
  }

  if (notLinked.length > 0) {
    return {
      ok: false,
      status: 'not_linked',
      not_linked: notLinked,
      message: `GitHub identity not linked for: ${notLinked.join(', ')}. Link github_user_id/github_login on the workspace member before assigning a mirrored GitHub issue.`,
    }
  }

  return { ok: true, assignees }
}
