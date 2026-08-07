import { useSyncExternalStore } from 'react'

type ImmersiveCapableAPI = {
  setImmersiveMode?: (immersive: boolean) => Promise<void> | void
}

function getDesktopAPI(): ImmersiveCapableAPI | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { desktopAPI?: ImmersiveCapableAPI }).desktopAPI
}

const readInactiveSnapshot = () => false

/** Binds desktop immersive state to React's external-store lifecycle. */
function subscribeToImmersiveMode(onStoreChange: () => void): () => void {
  void onStoreChange
  getDesktopAPI()?.setImmersiveMode?.(true)
  return () => getDesktopAPI()?.setImmersiveMode?.(false)
}

/**
 * Enter "immersive" mode for the lifetime of the component that calls it.
 *
 * On macOS desktop this hides the traffic-light window controls so full-screen
 * modals (create-workspace, onboarding, etc.) can place UI in the top-left
 * corner without fighting the native controls' hit-test. On web or non-macOS
 * desktop this is a no-op.
 */
export function useImmersiveMode(): void {
  useSyncExternalStore(
    subscribeToImmersiveMode,
    readInactiveSnapshot,
    readInactiveSnapshot,
  )
}
