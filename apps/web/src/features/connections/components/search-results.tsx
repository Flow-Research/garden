import { type RefObject } from 'react'
import { type RegistryEntry } from '@/lib/api/executor'
import { type ExecutorIntegrationItem } from '@/lib/executor-contract'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { FeaturedCard } from './featured-card'

export function SearchResults({
  entries,
  total,
  loading,
  loadingMore,
  loadMoreRef,
  error,
  installed,
  inspectingEntryId,
  onClear,
  onRetry,
  onInspect,
  onManage,
}: {
  entries: RegistryEntry[]
  total: number
  loading: boolean
  loadingMore: boolean
  loadMoreRef: RefObject<HTMLDivElement | null>
  error: unknown
  installed: readonly ExecutorIntegrationItem[]
  inspectingEntryId: string | null
  onClear: () => void
  onRetry: () => void
  onInspect: (entry: RegistryEntry) => void
  onManage: (id: string) => void
}) {
  if (loading) {
    return (
      <ul
        aria-hidden="true"
        className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <li
            key={index}
            className="h-36 animate-pulse rounded-xl bg-muted/20"
          />
        ))}
      </ul>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 py-8 text-sm">
        <p className="text-foreground">
          The integration catalog is unreachable.
        </p>
        <p className="text-muted-foreground">
          {error instanceof Error ? error.message : 'Try again in a moment.'}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 py-8">
        <p className="text-sm text-foreground">No integrations match.</p>
        <p className="text-sm text-muted-foreground">
          Try a provider name, API, or domain.
        </p>
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear search
        </Button>
      </div>
    )
  }
  return (
    <section aria-label="Search results">
      <p className="text-xs text-muted-foreground">
        {total.toLocaleString()} match{total === 1 ? '' : 'es'}
        {total > entries.length ? `, showing ${entries.length}` : ''}
      </p>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {entries.map((entry) => {
          const current = installed.find(
            (integration) => integration.providerId === entry.providerId,
          )
          return (
            <FeaturedCard
              key={entry.providerId}
              entry={entry}
              integration={current ?? null}
              highlighted={false}
              busy={inspectingEntryId === entry.providerId}
              onInspect={() => onInspect(entry)}
              onManage={() => current && onManage(current.slug)}
            />
          )
        })}
      </ul>
      <div ref={loadMoreRef} className="flex h-16 items-center justify-center">
        {loadingMore ? (
          <Spinner
            className="text-muted-foreground"
            aria-label="Loading more integrations"
          />
        ) : null}
      </div>
    </section>
  )
}
