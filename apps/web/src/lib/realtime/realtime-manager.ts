import { Result } from 'better-result'
import type { QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogBrowserEvent } from '@/lib/posthog-browser'
import { realtimeInvalidationRoots } from './invalidation'

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 15_000
const UNAUTHORIZED_CLOSE_CODES = new Set([1008, 4001, 4003])

let queryClient: QueryClient | null = null
let socket: WebSocket | null = null
let socketWorkspaceId: string | null = null
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let hasConnected = false
let initialized = false

/**
 * Opens the workspace realtime channel and keeps it aligned with the active
 * session/workspace. Store-subscription driven (no React effects); events only
 * invalidate query roots so data always refetches through access-checked APIs.
 */
export function initRealtime(client: QueryClient) {
  if (typeof window === 'undefined') return
  queryClient = client
  if (initialized) return
  initialized = true

  useWorkspaceStore.subscribe(() => reconcile())
  useAuthStore.subscribe(() => reconcile())
  reconcile()
}

function reconcile() {
  const userId = useAuthStore.getState().user?.id ?? null
  const workspaceId = useWorkspaceStore.getState().workspace?.id ?? null
  const target = userId ? workspaceId : null
  if (target === socketWorkspaceId) return

  disconnect()
  socketWorkspaceId = target
  if (target) connect(target)
}

function connect(workspaceId: string) {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const next = new WebSocket(
    `${scheme}://${window.location.host}/api/realtime?workspace_id=${encodeURIComponent(workspaceId)}`,
  )
  socket = next

  next.onopen = () => {
    if (socket !== next) return
    if (hasConnected) invalidateWorkspace(workspaceId)
    hasConnected = true
    reconnectAttempt = 0
  }

  next.onmessage = (event: MessageEvent) => {
    if (socket !== next) return
    handleMessage(workspaceId, event.data)
  }

  next.onclose = (event: CloseEvent) => {
    if (socket !== next) return
    socket = null
    if (UNAUTHORIZED_CLOSE_CODES.has(event.code)) return
    scheduleReconnect(workspaceId)
  }
}

function scheduleReconnect(workspaceId: string) {
  if (reconnectTimer) return
  const delay =
    Math.min(BASE_BACKOFF_MS * 2 ** reconnectAttempt, MAX_BACKOFF_MS) +
    Math.random() * 250
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (socketWorkspaceId !== workspaceId || socket) return
    connect(workspaceId)
  }, delay)
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempt = 0
  hasConnected = false
  if (socket) {
    socket.onclose = null
    socket.close()
    socket = null
  }
}

function handleMessage(workspaceId: string, data: unknown) {
  if (typeof data !== 'string' || !queryClient) return
  const parsed = Result.try(
    () =>
      JSON.parse(data) as {
        type?: unknown
        workspace_id?: unknown
        published_at?: unknown
      },
  )
  if (parsed.isErr()) return

  const envelope = parsed.value
  const roots = realtimeInvalidationRoots(envelope, workspaceId)
  if (!roots) return

  for (const root of roots) {
    void queryClient.invalidateQueries({ queryKey: root })
  }

  capturePostHogBrowserEvent(GARDEN_ANALYTICS_EVENTS.realtimeEventApplied, {
    type: envelope.type,
    published_at: envelope.published_at ?? null,
    publish_to_invalidate_ms:
      typeof envelope.published_at === 'number'
        ? Date.now() - envelope.published_at
        : null,
  })
}

function invalidateWorkspace(workspaceId: string) {
  if (!queryClient) return
  void queryClient.invalidateQueries({ queryKey: ['teams', workspaceId] })
  void queryClient.invalidateQueries({ queryKey: ['issues', workspaceId] })
}
