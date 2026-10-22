export type InjectableItem = {
  readonly id: string
  readonly label: string
  readonly summary?: string
  readonly observedAt?: string
}

export type InjectionSource = 'anchor' | 'search'

export type InjectedItem = InjectableItem & {
  readonly origin: InjectionSource
}

export type ScoredInjectable = {
  readonly item: InjectableItem
  readonly score: number
}

export type InjectionInput = {
  readonly anchors: readonly InjectableItem[]
  readonly hits: readonly ScoredInjectable[]
  readonly maxAnchors: number
  readonly maxItems: number
  readonly relevanceFloor: number
}

export const selectInjection = (
  input: InjectionInput,
): readonly InjectedItem[] => {
  const seen = new Set<string>()
  const selected: InjectedItem[] = []

  const maxItems = Number.isFinite(input.maxItems)
    ? Math.max(0, Math.trunc(input.maxItems))
    : 0
  const maxAnchors = Number.isFinite(input.maxAnchors)
    ? Math.max(0, Math.trunc(input.maxAnchors))
    : 0
  const floor = Number.isFinite(input.relevanceFloor) ? input.relevanceFloor : 0

  const push = (item: InjectableItem, origin: InjectionSource): void => {
    if (selected.length >= maxItems) return
    if (seen.has(item.id)) return
    seen.add(item.id)
    selected.push({ ...item, origin })
  }

  for (const anchor of input.anchors.slice(0, maxAnchors)) {
    push(anchor, 'anchor')
  }

  const ranked = [...input.hits].sort((left, right) => right.score - left.score)
  for (const hit of ranked) {
    if (hit.score < floor) continue
    push(hit.item, 'search')
  }

  return selected
}
