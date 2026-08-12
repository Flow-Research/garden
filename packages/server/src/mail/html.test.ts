import { describe, expect, it } from 'vitest'
import { sanitizeAuthoredMailHtml } from './html.ts'

describe('sanitizeAuthoredMailHtml', () => {
  it('keeps composer formatting while removing active and remote content', () => {
    expect(
      sanitizeAuthoredMailHtml(
        '<p onclick="steal()"><strong>Hello</strong><script>alert(1)</script>' +
          '<img src="https://tracker.test/pixel">' +
          '<a href="javascript:steal()">bad</a>' +
          '<a href="https://garden.test">good</a></p>',
      ),
    ).toBe(
      '<p><strong>Hello</strong><a rel="noopener noreferrer" target="_blank">bad</a>' +
        '<a href="https://garden.test" rel="noopener noreferrer" target="_blank">good</a></p>',
    )
  })

  it('normalizes an empty Tiptap document to null', () => {
    expect(sanitizeAuthoredMailHtml('<p></p>')).toBeNull()
  })
})
