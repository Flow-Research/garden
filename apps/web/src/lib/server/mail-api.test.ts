import { describe, expect, it } from 'vitest'
import { gmailLabelMutation } from './mail-api'

describe('gmail conversation state writeback', () => {
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
