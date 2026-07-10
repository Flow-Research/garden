import { describe, expect, it } from 'vitest'
import {
  preprocessMentionShortcodes,
  serializeMentionMarkdown,
  unescapeMentionLabel,
} from './mentions'

describe('mention markdown', () => {
  it('escapes user-controlled label punctuation', () => {
    expect(
      serializeMentionMarkdown({
        id: 'user-1',
        label: 'A](https://evil.example) [x',
        type: 'member',
      }),
    ).toBe(
      '[@A\\]\\(https\\:\\/\\/evil\\.example\\) \\[x](mention://member/user-1)',
    )
  })

  it('prevents emphasis, code, and HTML syntax in labels', () => {
    expect(
      serializeMentionMarkdown({
        id: 'user-1',
        label: '*Alex* `code` <b>x</b>',
        type: 'member',
      }),
    ).toBe(
      '[@\\*Alex\\* \\`code\\` \\<b\\>x\\<\\/b\\>](mention://member/user-1)',
    )
  })

  it('round-trips escaped labels for editor tokenization', () => {
    expect(
      unescapeMentionLabel('A\\]\\(https\\:\\/\\/evil\\.example\\) \\[x'),
    ).toBe('A](https://evil.example) [x')
  })

  it('normalizes legacy shortcodes through the canonical serializer', () => {
    expect(
      preprocessMentionShortcodes('Hello [@ id="user-1" label="A [x"]'),
    ).toBe('Hello [@A \\[x](mention://member/user-1)')
  })
})
