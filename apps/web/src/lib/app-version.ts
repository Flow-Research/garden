import { Result, type UnhandledException } from 'better-result'

const VERSION_MANIFEST_PATH = '/garden-version.json'
const VERSION_CHECK_INTERVAL_MS = 60_000
const CURRENT_VERSION_SNAPSHOT: AppVersionSnapshot = { kind: 'current' }

export type AppVersionSnapshot =
  | { kind: 'current' }
  | { kind: 'update-available'; version: string }

type VersionCheckOutcome =
  | { kind: 'current' }
  | { kind: 'unavailable' }
  | { kind: 'update-available'; version: string }

type VersionReader = () => Promise<
  Result<VersionCheckOutcome, UnhandledException>
>

export const gardenReleaseVersion =
  typeof __GARDEN_RELEASE_VERSION__ === 'string'
    ? __GARDEN_RELEASE_VERSION__
    : 'development'

/**
 * Validates the tiny static manifest before treating it as a deploy signal.
 * Missing, malformed, and same-version responses are normal background
 * outcomes; only a different non-empty version should interrupt the user.
 */
export function resolveVersionCheck(
  currentVersion: string,
  payload: unknown,
): VersionCheckOutcome {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('version' in payload) ||
    typeof payload.version !== 'string' ||
    payload.version.length === 0
  ) {
    return { kind: 'unavailable' }
  }

  return payload.version === currentVersion
    ? { kind: 'current' }
    : { kind: 'update-available', version: payload.version }
}

/**
 * Reads the current deployment marker without accepting browser or edge cache.
 * Network and JSON failures remain typed recoverable errors; the UI boundary
 * deliberately ignores them and checks again on the next focus/poll.
 */
function readDeployedVersion(
  currentVersion: string,
): Promise<Result<VersionCheckOutcome, UnhandledException>> {
  return Result.tryPromise(async () => {
    const url = new URL(VERSION_MANIFEST_PATH, window.location.origin)
    url.searchParams.set('current', currentVersion)
    const response = await window.fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return { kind: 'unavailable' as const }
    return resolveVersionCheck(currentVersion, await response.json())
  })
}

/**
 * Owns one shared deploy-version subscription without React effects. The first
 * subscriber starts an immediate check plus focus/visibility checks and a
 * low-frequency poll; the last subscriber tears all of them down. Once a new
 * deploy is found the snapshot stays available and background traffic stops.
 */
export function createAppVersionStore(
  currentVersion: string,
  readVersion: VersionReader = () => readDeployedVersion(currentVersion),
) {
  let snapshot: AppVersionSnapshot = CURRENT_VERSION_SNAPSHOT
  let interval: number | null = null
  let checkInFlight: Promise<void> | null = null
  const listeners = new Set<() => void>()

  const stopChecks = () => {
    if (interval !== null) {
      window.clearInterval(interval)
      interval = null
    }
    window.removeEventListener('focus', checkWhenActive)
    document.removeEventListener('visibilitychange', checkWhenActive)
  }

  const applyOutcome = (outcome: VersionCheckOutcome) => {
    if (outcome.kind !== 'update-available') return
    snapshot = outcome
    stopChecks()
    for (const listener of listeners) listener()
  }

  const check = () => {
    if (checkInFlight) return checkInFlight
    checkInFlight = readVersion().then((result) => {
      result.match({
        ok: applyOutcome,
        err: () => undefined,
      })
      checkInFlight = null
    })
    return checkInFlight
  }

  function checkWhenActive() {
    if (document.visibilityState === 'visible') void check()
  }

  const startChecks = () => {
    if (currentVersion === 'development' || interval !== null) return
    void check()
    interval = window.setInterval(checkWhenActive, VERSION_CHECK_INTERVAL_MS)
    window.addEventListener('focus', checkWhenActive)
    document.addEventListener('visibilitychange', checkWhenActive)
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => CURRENT_VERSION_SNAPSHOT,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) startChecks()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stopChecks()
      }
    },
  }
}

export const appVersionStore = createAppVersionStore(gardenReleaseVersion)

/**
 * Performs a cache-busting navigation to the same screen, then removes the
 * temporary marker from browser history after the new document starts.
 */
export function forceRefresh(version: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('__garden_refresh', version)
  window.location.replace(url)
}

/** Removes the force-refresh cache marker without another navigation. */
export function removeRefreshMarker() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('__garden_refresh')) return
  url.searchParams.delete('__garden_refresh')
  window.history.replaceState(window.history.state, '', url)
}
