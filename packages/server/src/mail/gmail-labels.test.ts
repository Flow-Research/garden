import { describe, expect, it } from 'vitest'
import { gmailLabelMutation } from './gmail-labels.ts'

describe('Gmail conversation state labels', () => {
  it.each([
    ['mark-read', [], ['UNREAD']],
    ['mark-unread', ['UNREAD'], []],
    ['archive', [], ['INBOX']],
    ['unarchive', ['INBOX'], []],
    ['pin', ['STARRED'], []],
    ['unpin', [], ['STARRED']],
  ] as const)(
    'maps %s to Gmail thread labels',
    (action, addLabelIds, removeLabelIds) => {
      expect(gmailLabelMutation(action)).toEqual({
        addLabelIds,
        removeLabelIds,
      })
    },
  )
})
