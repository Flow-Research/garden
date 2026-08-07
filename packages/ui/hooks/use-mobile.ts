import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

/** Subscribes React to the browser media query without effect-managed mirror state. */
function subscribeToMobileQuery(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_QUERY)
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

function readMobileQuery(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches
}

/** Returns false during SSR, then follows the viewport media query in the browser. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToMobileQuery,
    readMobileQuery,
    () => false,
  )
}
