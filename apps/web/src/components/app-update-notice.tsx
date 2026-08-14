import { useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  appVersionStore,
  forceRefresh,
  removeRefreshMarker,
} from '@/lib/app-version'

removeRefreshMarker()

/**
 * Shows a persistent bottom-left deploy notice modeled after T3 Code's update
 * pill. It is deliberately separate from transient Sonner toasts: stale tabs
 * need a durable action until the new browser bundle has loaded.
 */
export function AppUpdateNotice() {
  const snapshot = useSyncExternalStore(
    appVersionStore.subscribe,
    appVersionStore.getSnapshot,
    appVersionStore.getServerSnapshot,
  )

  if (snapshot.kind !== 'update-available') return null

  return (
    <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] z-50">
      <button
        type="button"
        aria-label="Update available. Refresh Garden"
        className="group flex h-9 items-center gap-2 rounded-lg border border-primary/20 bg-primary/15 px-3 text-xs font-medium text-primary shadow-lg shadow-black/10 backdrop-blur-xl transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => forceRefresh(snapshot.version)}
      >
        <RefreshCw className="size-3.5 transition-transform duration-300 group-hover:rotate-45" />
        <span>Update available</span>
        <span className="border-l border-primary/20 pl-2 font-semibold">
          Refresh
        </span>
      </button>
    </div>
  )
}
