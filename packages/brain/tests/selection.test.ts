import { describe, expect, it } from 'vitest'
import {
  selectInjection,
  type InjectableItem,
} from '../src/services/selection.ts'

const item = (id: string, label = id): InjectableItem => ({ id, label })

describe('selectInjection', () => {
  it('puts anchors first and caps them', () => {
    const selected = selectInjection({
      anchors: [item('a1'), item('a2'), item('a3')],
      hits: [],
      maxAnchors: 2,
      maxItems: 8,
      relevanceFloor: 0,
    })

    expect(selected.map((entry) => entry.id)).toEqual(['a1', 'a2'])
    expect(selected.every((entry) => entry.origin === 'anchor')).toBe(true)
  })

  it('drops search hits below the relevance floor and sorts the rest', () => {
    const selected = selectInjection({
      anchors: [],
      hits: [
        { item: item('low'), score: 0.1 },
        { item: item('mid'), score: 0.5 },
        { item: item('high'), score: 0.9 },
      ],
      maxAnchors: 4,
      maxItems: 8,
      relevanceFloor: 0.4,
    })

    expect(selected.map((entry) => entry.id)).toEqual(['high', 'mid'])
    expect(selected.every((entry) => entry.origin === 'search')).toBe(true)
  })

  it('does not repeat an anchor as a search hit', () => {
    const selected = selectInjection({
      anchors: [item('shared')],
      hits: [{ item: item('shared'), score: 1 }],
      maxAnchors: 4,
      maxItems: 8,
      relevanceFloor: 0,
    })

    expect(selected).toHaveLength(1)
    expect(selected[0]?.origin).toBe('anchor')
  })

  it('stops at maxItems across anchors and hits', () => {
    const selected = selectInjection({
      anchors: [item('a1'), item('a2')],
      hits: [
        { item: item('h1'), score: 1 },
        { item: item('h2'), score: 0.9 },
        { item: item('h3'), score: 0.8 },
      ],
      maxAnchors: 4,
      maxItems: 3,
      relevanceFloor: 0,
    })

    expect(selected.map((entry) => entry.id)).toEqual(['a1', 'a2', 'h1'])
  })

  it('treats non-finite caps as zero', () => {
    const selected = selectInjection({
      anchors: [item('a1')],
      hits: [{ item: item('h1'), score: 1 }],
      maxAnchors: 0,
      maxItems: Number.NaN,
      relevanceFloor: 0,
    })

    expect(selected).toEqual([])
  })
})
