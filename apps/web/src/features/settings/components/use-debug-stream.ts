import { useEffect, useState } from 'react'
import { Result } from 'better-result'
import type {
  DebugMetaPayload,
  DebugPromptPayload,
  DebugSandboxPayload,
  DebugToolsPayload,
  DebugWorkspacePayload,
} from '@/lib/environment-debug'
import { getApiTransport } from '@/lib/api/state'

/**
 * SSE consumer for `/api/debug-stream`. Exposes two entry points:
 *
 * - `useDebugStream({ open, ... })` — live subscription used by the drawer.
 *   Seeds from the prefetch cache when present so the drawer paints instantly
 *   on open, then still refreshes via a fresh stream.
 *
 * - `usePrefetchDebugStream({ enabled, ... })` — warms the cache from the chat
 *   screen while the drawer is closed, so the first open is zero-latency.
 */

export type DebugSection =
  | 'meta'
  | 'tools'
  | 'workspace'
  | 'sandbox'
  | 'prompt'

export type DebugState = {
  openAt: string | null
  meta: DebugMetaPayload | null
  tools: DebugToolsPayload | null
  workspace: DebugWorkspacePayload | null
  sandbox: DebugSandboxPayload | null
  prompt: DebugPromptPayload | null
  errors: Partial<Record<DebugSection, string>>
  pending: Set<DebugSection>
  done: boolean
  fatal: string | null
}

const ALL_SECTIONS: DebugSection[] = [
  'meta',
  'tools',
  'workspace',
  'sandbox',
  'prompt',
]

function makeInitialState(): DebugState {
  return {
    openAt: null,
    meta: null,
    tools: null,
    workspace: null,
    sandbox: null,
    prompt: null,
    errors: {},
    pending: new Set(ALL_SECTIONS),
    done: false,
    fatal: null,
  }
}

// ---------- snapshot cache (module-level) ----------

type CacheEntry = {
  snapshot: DebugState
  completedAt: number | null
  inFlight: AbortController | null
  subscribers: Set<() => void>
}

const CACHE_TTL_MS = 5 * 60_000
const snapshotCache = new Map<string, CacheEntry>()

function cacheKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`
}

function createCacheEntry(): CacheEntry {
  return {
    snapshot: makeInitialState(),
    completedAt: null,
    inFlight: null,
    subscribers: new Set(),
  }
}

function getCacheEntry(key: string): CacheEntry {
  const existing = snapshotCache.get(key)
  if (existing) return existing
  const entry = createCacheEntry()
  snapshotCache.set(key, entry)
  return entry
}

function notifyCacheEntry(entry: CacheEntry) {
  for (const subscriber of entry.subscribers) subscriber()
}

function readCache(key: string): DebugState | null {
  const entry = snapshotCache.get(key)
  if (!entry) return null
  if (entry.inFlight) return entry.snapshot
  if (!entry.completedAt) return null
  if (Date.now() - entry.completedAt > CACHE_TTL_MS) return null
  return entry.snapshot
}

function shouldRefresh(entry: CacheEntry) {
  if (entry.inFlight) return false
  if (!entry.completedAt) return true
  return Date.now() - entry.completedAt > CACHE_TTL_MS
}

function resetCacheEntry(entry: CacheEntry) {
  entry.inFlight?.abort()
  entry.snapshot = makeInitialState()
  entry.completedAt = null
  entry.inFlight = null
  notifyCacheEntry(entry)
}

// ---------- frame handling ----------

function safeParse(raw: string): unknown {
  if (!raw) return undefined
  const parsed = Result.try(() => JSON.parse(raw) as unknown)
  return Result.isError(parsed) ? undefined : parsed.value
}

function applyFrame(
  state: DebugState,
  event: string,
  data: string,
): DebugState {
  const parsed = safeParse(data)
  if (parsed === undefined) return state

  const clearPending = (k: DebugSection) => {
    const p = new Set(state.pending)
    p.delete(k)
    return p
  }

  switch (event) {
    case 'open':
      return {
        ...state,
        openAt: (parsed as { generatedAt: string }).generatedAt,
      }
    case 'meta':
      return {
        ...state,
        meta: parsed as DebugMetaPayload,
        pending: clearPending('meta'),
      }
    case 'tools':
      return {
        ...state,
        tools: parsed as DebugToolsPayload,
        pending: clearPending('tools'),
      }
    case 'workspace':
      return {
        ...state,
        workspace: parsed as DebugWorkspacePayload,
        pending: clearPending('workspace'),
      }
    case 'sandbox':
      return {
        ...state,
        sandbox: parsed as DebugSandboxPayload,
        pending: clearPending('sandbox'),
      }
    case 'prompt':
      return {
        ...state,
        prompt: parsed as DebugPromptPayload,
        pending: clearPending('prompt'),
      }
    case 'error': {
      const err = parsed as { section: string; message: string }
      return {
        ...state,
        errors: { ...state.errors, [err.section]: err.message },
        pending: clearPending(err.section as DebugSection),
      }
    }
    case 'done':
      return { ...state, done: true }
    default:
      return state
  }
}

// ---------- stream consumer ----------

async function consumeStream(
  workspaceId: string,
  sessionId: string,
  signal: AbortSignal,
  onUpdate: (reducer: (state: DebugState) => DebugState) => void,
): Promise<void> {
  const url = new URL('/api/debug-stream', window.location.origin)
  url.searchParams.set('workspace_id', workspaceId)
  url.searchParams.set('session_id', sessionId)

  const res = await fetch(url.toString(), {
    credentials: 'include',
    signal,
  }).catch((cause) => {
    if (signal.aborted) return null
    onUpdate((s) => ({
      ...s,
      fatal: cause instanceof Error ? cause.message : String(cause),
    }))
    return null
  })

  if (!res) return
  if (!res.ok || !res.body) {
    onUpdate((s) => ({ ...s, fatal: `Debug stream failed (${res.status})` }))
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)

      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) onUpdate((s) => applyFrame(s, event, data))
      sep = buffer.indexOf('\n\n')
    }
  }
}

// ---------- prefetch ----------

export function prefetchDebugStream(
  workspaceId: string | null,
  sessionId: string | null,
): void {
  if (!workspaceId || !sessionId) return
  const key = cacheKey(workspaceId, sessionId)
  const entry = getCacheEntry(key)
  if (!shouldRefresh(entry)) return

  const ctl = new AbortController()
  entry.snapshot = makeInitialState()
  entry.completedAt = null
  entry.inFlight = ctl
  notifyCacheEntry(entry)

  void consumeStream(workspaceId, sessionId, ctl.signal, (reducer) => {
    entry.snapshot = reducer(entry.snapshot)
    notifyCacheEntry(entry)
  }).finally(() => {
    if (entry.inFlight !== ctl) return
    entry.inFlight = null
    entry.completedAt = Date.now()
    notifyCacheEntry(entry)
  })
}

export async function refreshDebugPrompt(
  workspaceId: string | null,
  sessionId: string | null,
): Promise<void> {
  if (!workspaceId || !sessionId) return

  const search = new URLSearchParams({
    workspace_id: workspaceId,
    session_id: sessionId,
  })

  await getApiTransport().request(`/api/debug-stream?${search}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'refresh_prompt' }),
  })

  const key = cacheKey(workspaceId, sessionId)
  const entry = getCacheEntry(key)
  resetCacheEntry(entry)
  prefetchDebugStream(workspaceId, sessionId)
}

// ---------- live hook ----------

export function useDebugStream({
  open,
  workspaceId,
  sessionId,
}: {
  open: boolean
  workspaceId: string | null
  sessionId: string | null
}): DebugState {
  const [state, setState] = useState<DebugState>(() => {
    if (!workspaceId || !sessionId) return makeInitialState()
    return readCache(cacheKey(workspaceId, sessionId)) ?? makeInitialState()
  })

  useEffect(() => {
    if (!open || !workspaceId || !sessionId) return

    const key = cacheKey(workspaceId, sessionId)
    const entry = getCacheEntry(key)
    const syncFromCache = () => setState(entry.snapshot)
    entry.subscribers.add(syncFromCache)

    const cached = readCache(key)
    setState(cached ?? makeInitialState())

    prefetchDebugStream(workspaceId, sessionId)

    return () => {
      entry.subscribers.delete(syncFromCache)
    }
  }, [open, workspaceId, sessionId])

  return state
}

// ---------- prefetch hook ----------

export function usePrefetchDebugStream({
  enabled,
  workspaceId,
  sessionId,
}: {
  enabled: boolean
  workspaceId: string | null
  sessionId: string | null
}): void {
  useEffect(() => {
    if (!enabled) return
    prefetchDebugStream(workspaceId, sessionId)
  }, [enabled, workspaceId, sessionId])
}
