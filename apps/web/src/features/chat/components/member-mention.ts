import type { MemberWithUser } from '@garden/core/types'

export type MemberMentionTrigger = {
  query: string
  rangeStart: number
  rangeEnd: number
}

export type SelectedMemberMention = {
  id: string
  label: string
}

/** Detects the active `@query` token immediately before the textarea caret. */
export function detectMemberMentionTrigger(
  input: string,
  cursor: number,
): MemberMentionTrigger | null {
  const beforeCursor = input.slice(0, cursor)
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null

  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return null
  return {
    query: match[1] ?? '',
    rangeStart: atIndex,
    rangeEnd: cursor,
  }
}

/** Ranks warm-cache members by name/email prefix before substring matches. */
export function searchComposerMembers(
  members: readonly MemberWithUser[],
  query: string,
): MemberWithUser[] {
  const normalized = query.trim().toLocaleLowerCase()
  return members
    .map((member, index) => {
      const name = member.name.toLocaleLowerCase()
      const email = member.email.toLocaleLowerCase()
      const score = !normalized
        ? 2
        : name.startsWith(normalized)
          ? 0
          : email.startsWith(normalized)
            ? 1
            : name.includes(normalized) || email.includes(normalized)
              ? 2
              : null
      return { member, index, score }
    })
    .filter(
      (
        entry,
      ): entry is {
        member: MemberWithUser
        index: number
        score: number
      } => entry.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, 8)
    .map((entry) => entry.member)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Converts selected display tokens to the persisted mention-link contract only
 * at send time, keeping the textarea readable while chat markdown receives a
 * stable workspace user id.
 */
export function serializeMemberMentions(
  input: string,
  mentions: readonly SelectedMemberMention[],
): string {
  return mentions.reduce((content, mention) => {
    const token = `@${mention.label}`
    const pattern = new RegExp(
      `(^|\\s)${escapeRegExp(token)}(?=\\s|$|[.,!?;:])`,
      'g',
    )
    return content.replace(
      pattern,
      (_, prefix: string) =>
        `${prefix}[@${mention.label}](mention://member/${mention.id})`,
    )
  }, input)
}
