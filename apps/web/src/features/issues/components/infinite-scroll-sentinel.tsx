import { useEffect, useRef } from 'react'
import { Spinner } from '@garden/ui/components/ui/spinner'

/** Sentinel that triggers `onVisible` when scrolled into view. */
export function InfiniteScrollSentinel({
  onVisible,
  loading,
}: {
  onVisible: () => void
  loading: boolean
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisibleRef.current()
      },
      { rootMargin: '100px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-2">
      {loading && <Spinner className="size-3 text-muted-foreground" />}
    </div>
  )
}
