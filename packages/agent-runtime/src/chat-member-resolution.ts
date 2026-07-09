import { Result, type Result as ResultValue } from 'better-result'

export type WorkspaceMemberCandidate = {
  membershipId: string
  userId: string
  name: string
  email: string
  role: string
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/**
 * Resolves a human assignee without guessing across duplicate workspace names.
 * Stable user/membership ids and email win; names may use a unique substring
 * for natural chat requests. Ambiguous matches return a bounded explanation so
 * the model can ask the user or list members instead of silently picking one.
 */
export function resolveWorkspaceMember(
  members: readonly WorkspaceMemberCandidate[],
  selector: string,
): ResultValue<WorkspaceMemberCandidate, string> {
  const query = normalized(selector)
  if (!query) return Result.err('assignee_member must not be empty.')

  const exactIdentityMatches = members.filter(
    (member) =>
      normalized(member.userId) === query ||
      normalized(member.membershipId) === query ||
      normalized(member.email) === query,
  )
  const exactIdentityMatch = exactIdentityMatches.at(0)
  if (exactIdentityMatches.length === 1 && exactIdentityMatch) {
    return Result.ok(exactIdentityMatch)
  }

  const exactNameMatches = members.filter(
    (member) => normalized(member.name) === query,
  )
  const exactNameMatch = exactNameMatches.at(0)
  if (exactNameMatches.length === 1 && exactNameMatch) {
    return Result.ok(exactNameMatch)
  }

  const fuzzyMatches = members.filter(
    (member) =>
      normalized(member.name).includes(query) ||
      normalized(member.email).includes(query),
  )
  const fuzzyMatch = fuzzyMatches.at(0)
  if (fuzzyMatches.length === 1 && fuzzyMatch) return Result.ok(fuzzyMatch)

  const candidates = (
    exactIdentityMatches.length > 1
      ? exactIdentityMatches
      : exactNameMatches.length > 1
        ? exactNameMatches
        : fuzzyMatches
  ).slice(0, 5)
  if (candidates.length > 1) {
    return Result.err(
      `assignee_member is ambiguous: ${candidates
        .map((member) => `${member.name} <${member.email}> (${member.userId})`)
        .join(', ')}`,
    )
  }

  return Result.err(
    `No workspace member matched "${selector}". Call list_workspace_inventory with include:['members'] to inspect valid people.`,
  )
}
