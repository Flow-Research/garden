import { describe, expect, it } from 'vitest'
import type { MemberWithUser } from '@garden/core/types'
import {
  detectMemberMentionTrigger,
  isMemberMentionSelectionKey,
  rebaseMemberMentions,
  resolveMemberMentionTextEdit,
  searchComposerMembers,
  serializeMemberMentions,
} from './member-mention'

function member(id: string, name: string, email: string): MemberWithUser {
  return {
    id: `membership-${id}`,
    user_id: id,
    name,
    email,
    role: 'member',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('member mention composer helpers', () => {
  it('detects an active @ token at the caret', () => {
    expect(detectMemberMentionTrigger('Ask @kon', 8)).toEqual({
      query: 'kon',
      rangeStart: 4,
      rangeEnd: 8,
    })
    expect(detectMemberMentionTrigger('email@test.com', 14)).toBeNull()
    expect(detectMemberMentionTrigger('Ask @kon later', 14)).toBeNull()
  })

  it('does not select a member while IME text is composing', () => {
    expect(
      isMemberMentionSelectionKey({ key: 'Enter', isComposing: true }),
    ).toBe(false)
    expect(
      isMemberMentionSelectionKey({ key: 'Enter', isComposing: false }),
    ).toBe(true)
    expect(
      isMemberMentionSelectionKey({ key: 'Escape', isComposing: false }),
    ).toBe(false)
  })

  it('filters and ranks members from the shared cache', () => {
    const members = [
      member('1', 'Morgan Lee', 'morgan@example.test'),
      member('2', 'Avery Stone', 'avery@example.test'),
      member('3', 'Research Lead', 'avery.research@example.test'),
    ]

    expect(
      searchComposerMembers(members, 'ave').map((result) => result.user_id),
    ).toEqual(['2', '3'])
  })

  it('preserves actor identity for duplicate display names', () => {
    expect(
      serializeMemberMentions('Ask @Alex and @Alex', [
        { id: 'user-1', label: 'Alex', start: 4, end: 9 },
        { id: 'user-2', label: 'Alex', start: 14, end: 19 },
      ]),
    ).toBe(
      'Ask [@Alex](mention://member/user-1) and [@Alex](mention://member/user-2)',
    )
  })

  it('preserves the surviving duplicate identity after deleting either occurrence', () => {
    const input = '@Alex @Alex'
    const mentions = [
      { id: 'user-1', label: 'Alex', start: 0, end: 5 },
      { id: 'user-2', label: 'Alex', start: 6, end: 11 },
    ] as const

    expect(
      rebaseMemberMentions(input, '@Alex', mentions, {
        previousStart: 0,
        previousEnd: 6,
        nextEnd: 0,
      }),
    ).toEqual([{ id: 'user-2', label: 'Alex', start: 0, end: 5 }])
    expect(
      rebaseMemberMentions(input, '@Alex', mentions, {
        previousStart: 5,
        previousEnd: 11,
        nextEnd: 5,
      }),
    ).toEqual([{ id: 'user-1', label: 'Alex', start: 0, end: 5 }])
  })

  it('rebases an intact mention after collapsed Backspace and Delete edits', () => {
    const mention = { id: 'user-1', label: 'Alex', start: 2, end: 7 }
    const backwardEdit = resolveMemberMentionTextEdit({
      previousInput: 'x @Alex',
      nextInput: ' @Alex',
      selectionStart: 1,
      selectionEnd: 1,
      inputType: 'deleteContentBackward',
    })
    expect(
      rebaseMemberMentions('x @Alex', ' @Alex', [mention], backwardEdit),
    ).toEqual([{ ...mention, start: 1, end: 6 }])

    const forwardEdit = resolveMemberMentionTextEdit({
      previousInput: 'x @Alex',
      nextInput: 'x@Alex',
      selectionStart: 1,
      selectionEnd: 1,
      inputType: 'deleteContentForward',
    })
    expect(
      rebaseMemberMentions('x @Alex', 'x@Alex', [mention], forwardEdit),
    ).toEqual([{ ...mention, start: 1, end: 6 }])
  })

  it('rebases mentions across programmatic skill expansion', () => {
    const input = '/x @Alex @Alex'
    const nextInput = '/skill-x @Alex @Alex'

    expect(
      rebaseMemberMentions(
        input,
        nextInput,
        [
          { id: 'user-1', label: 'Alex', start: 3, end: 8 },
          { id: 'user-2', label: 'Alex', start: 9, end: 14 },
        ],
        {
          previousStart: 0,
          previousEnd: 3,
          nextEnd: 9,
        },
      ),
    ).toEqual([
      { id: 'user-1', label: 'Alex', start: 9, end: 14 },
      { id: 'user-2', label: 'Alex', start: 15, end: 20 },
    ])
  })

  it('drops edited occurrences instead of promoting later literal text', () => {
    const mentions = [
      { id: 'user-1', label: 'Alex', start: 4, end: 9 },
    ] as const

    expect(rebaseMemberMentions('Ask @Alex', 'Ask ', mentions)).toEqual([])
    expect(serializeMemberMentions('Ask literal @Alex', mentions)).toBe(
      'Ask literal @Alex',
    )
  })

  it('rebases intact mentions after edits before their range', () => {
    expect(
      rebaseMemberMentions('Ask @Alex', 'Please Ask @Alex', [
        { id: 'user-1', label: 'Alex', start: 4, end: 9 },
      ]),
    ).toEqual([{ id: 'user-1', label: 'Alex', start: 11, end: 16 }])
  })

  it('escapes user-controlled Markdown punctuation in labels', () => {
    const input = '@A](https://evil.example) [x'
    expect(
      serializeMemberMentions(input, [
        {
          id: 'user-1',
          label: 'A](https://evil.example) [x',
          start: 0,
          end: input.length,
        },
      ]),
    ).toBe(
      '[@A\\]\\(https\\:\\/\\/evil\\.example\\) \\[x](mention://member/user-1)',
    )
  })
})
