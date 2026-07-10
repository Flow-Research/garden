import type { MemberWithUser } from '@garden/core/types'
import { serializeMentionMarkdown } from '@garden/ui/markdown'

export type MemberMentionTrigger = {
  query: string
  rangeStart: number
  rangeEnd: number
}

export type SelectedMemberMention = {
  id: string
  label: string
  start: number
  end: number
}

export type MemberMentionTextEdit = {
  previousStart: number
  previousEnd: number
  nextEnd: number
}

/** Resolves the exact changed range from textarea beforeinput metadata. */
export function resolveMemberMentionTextEdit(args: {
  previousInput: string
  nextInput: string
  selectionStart: number
  selectionEnd: number
  inputType: string
}): MemberMentionTextEdit {
  const replacedLength = args.selectionEnd - args.selectionStart
  const insertedLength =
    args.nextInput.length - (args.previousInput.length - replacedLength)

  if (
    replacedLength === 0 &&
    insertedLength < 0 &&
    args.inputType.startsWith('delete')
  ) {
    const deletedLength = -insertedLength
    const deletesBackward = args.inputType.endsWith('Backward')
    const previousStart = deletesBackward
      ? Math.max(0, args.selectionStart - deletedLength)
      : args.selectionStart
    return {
      previousStart,
      previousEnd: deletesBackward
        ? args.selectionStart
        : args.selectionStart + deletedLength,
      nextEnd: previousStart,
    }
  }

  return {
    previousStart: args.selectionStart,
    previousEnd: args.selectionEnd,
    nextEnd: args.selectionStart + Math.max(0, insertedLength),
  }
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

/** Prevents IME confirmation Enter from selecting a mention candidate. */
export function isMemberMentionSelectionKey(args: {
  key: string
  isComposing: boolean
}) {
  return !args.isComposing && (args.key === 'Tab' || args.key === 'Enter')
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

/**
 * Rebases occurrence-backed mention ranges across one textarea edit. Mentions
 * touched by the edit are dropped rather than guessed; intact mentions before
 * or after the edit retain their actor identity even when display names match.
 */
export function rebaseMemberMentions(
  previousInput: string,
  nextInput: string,
  mentions: readonly SelectedMemberMention[],
  knownEdit?: MemberMentionTextEdit,
): SelectedMemberMention[] {
  let previousStart = knownEdit?.previousStart ?? 0
  let previousEnd = knownEdit?.previousEnd ?? 0
  let nextEnd = knownEdit?.nextEnd ?? 0

  if (!knownEdit) {
    const sharedLength = Math.min(previousInput.length, nextInput.length)
    while (
      previousStart < sharedLength &&
      previousInput[previousStart] === nextInput[previousStart]
    ) {
      previousStart += 1
    }

    let suffixLength = 0
    while (
      suffixLength < previousInput.length - previousStart &&
      suffixLength < nextInput.length - previousStart &&
      previousInput[previousInput.length - suffixLength - 1] ===
        nextInput[nextInput.length - suffixLength - 1]
    ) {
      suffixLength += 1
    }
    previousEnd = previousInput.length - suffixLength
    nextEnd = nextInput.length - suffixLength
  }

  const delta = nextEnd - previousEnd

  return mentions.flatMap((mention) => {
    const rebased =
      mention.end <= previousStart
        ? mention
        : mention.start >= previousEnd
          ? {
              ...mention,
              start: mention.start + delta,
              end: mention.end + delta,
            }
          : null
    if (!rebased) return []
    return nextInput.slice(rebased.start, rebased.end) === `@${rebased.label}`
      ? [rebased]
      : []
  })
}

/**
 * Serializes only intact selected occurrences, from right to left so replacing
 * one mention cannot shift another. Identity comes from the recorded range,
 * never from globally matching user-controlled display text.
 */
export function serializeMemberMentions(
  input: string,
  mentions: readonly SelectedMemberMention[],
): string {
  return [...mentions]
    .filter(
      (mention) =>
        input.slice(mention.start, mention.end) === `@${mention.label}`,
    )
    .sort((left, right) => right.start - left.start)
    .reduce(
      (content, mention) =>
        content.slice(0, mention.start) +
        serializeMentionMarkdown({
          id: mention.id,
          label: mention.label,
          type: 'member',
        }) +
        content.slice(mention.end),
      input,
    )
}
