import { describe, expect, it } from 'vitest'
import { compareOrderKeys, isOrderKey, orderKeyBetween } from './order-key'

describe('issue order keys', () => {
  it('always finds room between two neighbours', () => {
    let before = 'a0'
    const after = 'a1'
    // Repeated drops into the same gap: integers and floats run out here.
    for (let index = 0; index < 200; index++) {
      const key = orderKeyBetween(before, after)
      expect(compareOrderKeys(before, key)).toBe(-1)
      expect(compareOrderKeys(key, after)).toBe(-1)
      before = key
    }
  })

  it('places keys at either end', () => {
    expect(compareOrderKeys(orderKeyBetween(null, 'a0'), 'a0')).toBe(-1)
    expect(compareOrderKeys('a0', orderKeyBetween('a0', null))).toBe(-1)
    expect(orderKeyBetween(null, null)).toBe('a0')
  })

  it('falls back to after the first neighbour when they are out of order', () => {
    const key = orderKeyBetween('a5', 'a2')
    expect(compareOrderKeys('a5', key)).toBe(-1)
  })

  it('sorts by code unit, so upper-case heads come before lower-case', () => {
    expect(['a0', 'Zz', 'a0V'].sort(compareOrderKeys)).toEqual([
      'Zz',
      'a0',
      'a0V',
    ])
  })

  it('validates keys', () => {
    expect(isOrderKey('a0')).toBe(true)
    expect(isOrderKey('a0V')).toBe(true)
    expect(isOrderKey('3.5')).toBe(false)
    expect(isOrderKey('a00')).toBe(false)
    expect(isOrderKey('')).toBe(false)
  })
})
