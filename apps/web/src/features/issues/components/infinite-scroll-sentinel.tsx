import { useEffect, useRef } from 'react'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'

/**
 * Sentinel that triggers `onVisible` when scrolled into view.
 *
 * It observes again after every load, because an observer reports only
 * changes in visibility: when a page was too short to push the sentinel off
 * screen, nothing loaded after it. Observing an element that is already
 * visible reports it straight away. After a failure it stops and offers a
 * retry instead of failing silently.
 */
export function InfiniteScrollSentinel({
  onVisible,
  loading,
  failed = false,
}: {
  onVisible: () => void
  loading: boolean
  failed?: boolean
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  useEffect(() => {
    onVisibleRef.current = onVisible
  })

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || loading || failed) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisibleRef.current()
      },
      { rootMargin: '100px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loading, failed])

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-2">
      {loading ? <Spinner className="size-3 text-muted-foreground" /> : null}
      {failed && !loading ? (
        <Button variant="ghost" size="xs" onClick={onVisible}>
          Couldn't load more. Try again
        </Button>
      ) : null}
    </div>
  )
}
