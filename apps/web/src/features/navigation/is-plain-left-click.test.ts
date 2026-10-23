import { describe, expect, it } from 'vitest'
import { isPlainLeftClick } from './is-plain-left-click'

const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}

describe('isPlainLeftClick', () => {
  it('accepts an unmodified primary click', () => {
    expect(isPlainLeftClick(plain)).toBe(true)
  })

  it('rejects modified and non-primary clicks', () => {
    expect(isPlainLeftClick({ ...plain, metaKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, ctrlKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, shiftKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, altKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, button: 1 })).toBe(false)
  })
})
