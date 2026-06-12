type GardenStructuredLog = {
  source: 'garden'
  schemaVersion: number
  timestamp?: string
  level?: string
  service?: string
  component?: string
  event?: string
  requestId?: string
  userId?: string
  workspaceId?: string
  agentId?: string
  threadId?: string
  issueId?: string
  automationId?: string
  runId?: string
  connectorId?: string
  status?: number
  durationMs?: number
}

type TailSummary = {
  source: 'garden-tail-observer'
  schemaVersion: 1
  timestamp: string
  producerService: string | null
  outcome: string
  trigger: string
  message: string
  method?: string
  path?: string
  status?: number
  colo?: string
  producerLevel?: string
  producerComponent?: string
  producerEvent?: string
  producerRequestId?: string
  exceptionName?: string
  exceptionMessage?: string
  cpuTime?: number
  wallTime?: number
  truncated?: boolean
  appEvents: GardenStructuredLog[]
  exceptions: Array<{ name: string; message: string }>
}

const SCHEMA_VERSION = 1
const ERROR_LEVELS = new Set(['warn', 'error'])

export default {
  /**
   * Normalizes Cloudflare Worker trace events from all Garden producer Workers.
   * No external sink is configured yet: this observer emits compact structured
   * summaries to its own Workers Logs so we can verify app-level coverage first.
   * Future sinks can consume this same normalized shape. References consulted:
   * Cloudflare Tail Workers docs and Workers Trace Events/TailEvent types.
   */
  async tail(events: TraceItem[]) {
    for (const event of events) {
      const appEvents = extractGardenLogs(event)
      const exceptions = event.exceptions.map((exception) => ({
        name: exception.name,
        message: exception.message,
      }))

      const summary: TailSummary = {
        source: 'garden-tail-observer',
        schemaVersion: SCHEMA_VERSION,
        timestamp: new Date(event.eventTimestamp ?? Date.now()).toISOString(),
        producerService: event.scriptName,
        outcome: event.outcome,
        trigger: triggerName(event.event),
        ...fetchEventFields(event.event),
        cpuTime: event.cpuTime,
        wallTime: event.wallTime,
        truncated: event.truncated,
        appEvents,
        exceptions,
        message: summaryMessage(event, appEvents, exceptions),
        ...summarySignalFields(appEvents, exceptions),
      }

      if (shouldLogSummary(summary)) emitSummary(summary)
    }
  },
} satisfies ExportedHandler

function shouldLogSummary(summary: TailSummary) {
  if (summary.outcome !== 'ok') return true
  if (summary.exceptions.length > 0) return true
  return summary.appEvents.some((event) => ERROR_LEVELS.has(event.level ?? ''))
}

/**
 * Emits observer summaries with a dashboard-readable top-level message. Before
 * this, Cloudflare's Tail Worker invocation rows rendered as repeated "tail"
 * entries, which hid the producer route/error signal unless every row was
 * expanded. After this, persisted observer rows carry the producer, route,
 * outcome, and first app event/exception in the row text. Reference: Workers
 * Logs structured JSON guidance says object logs are indexed and `message`
 * remains the human-readable field.
 */
function emitSummary(summary: TailSummary) {
  const hasError =
    summary.outcome !== 'ok' ||
    summary.exceptions.length > 0 ||
    summary.appEvents.some((event) => event.level === 'error')

  if (hasError) {
    console.error(summary)
    return
  }

  console.warn(summary)
}

function summaryMessage(
  event: TraceItem,
  appEvents: GardenStructuredLog[],
  exceptions: Array<{ name: string; message: string }>,
) {
  const fields = fetchEventFields(event.event)
  const route =
    fields.method && fields.path
      ? `${fields.method} ${fields.path}`
      : triggerName(event.event)
  const signalFields = summarySignalFields(appEvents, exceptions)
  const signal = signalFields.exceptionMessage
    ? `${signalFields.exceptionName ?? 'Exception'}: ${signalFields.exceptionMessage}`
    : [
        signalFields.producerLevel,
        signalFields.producerComponent,
        signalFields.producerEvent,
      ]
        .filter(Boolean)
        .join(' ') || event.outcome

  return [event.scriptName ?? 'unknown-worker', route, signal]
    .filter(Boolean)
    .join(' | ')
}

function summarySignalFields(
  appEvents: GardenStructuredLog[],
  exceptions: Array<{ name: string; message: string }>,
) {
  const firstAppEvent =
    appEvents.find((entry) => ERROR_LEVELS.has(entry.level ?? '')) ?? appEvents[0]
  const firstException = exceptions[0]

  return {
    ...(firstAppEvent?.level ? { producerLevel: firstAppEvent.level } : {}),
    ...(firstAppEvent?.component
      ? { producerComponent: firstAppEvent.component }
      : {}),
    ...(firstAppEvent?.event ? { producerEvent: firstAppEvent.event } : {}),
    ...(firstAppEvent?.requestId
      ? { producerRequestId: firstAppEvent.requestId }
      : {}),
    ...(firstException?.name ? { exceptionName: firstException.name } : {}),
    ...(firstException?.message
      ? { exceptionMessage: firstException.message }
      : {}),
  }
}

function extractGardenLogs(event: TraceItem): GardenStructuredLog[] {
  const fromConsole = event.logs.flatMap((log) => extractGardenRecords(log.message))
  const fromDiagnostics = event.diagnosticsChannelEvents.flatMap((entry) =>
    entry.channel === 'garden.telemetry'
      ? extractGardenRecords(entry.message)
      : [],
  )
  return [...fromConsole, ...fromDiagnostics]
}

function extractGardenRecords(message: unknown): GardenStructuredLog[] {
  if (isGardenStructuredLog(message)) return [message]
  if (Array.isArray(message)) {
    return message.filter(isGardenStructuredLog)
  }
  return []
}

function isGardenStructuredLog(value: unknown): value is GardenStructuredLog {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { source?: unknown; schemaVersion?: unknown }
  return candidate.source === 'garden' && typeof candidate.schemaVersion === 'number'
}

function triggerName(event: TraceItem['event']) {
  if (!event) return 'unknown'
  if ('request' in event) return 'fetch'
  if ('rpcMethod' in event) return 'rpc'
  if ('cron' in event) return 'scheduled'
  if ('queue' in event) return 'queue'
  if ('scheduledTime' in event) return 'alarm'
  return 'custom'
}

function fetchEventFields(event: TraceItem['event']) {
  if (!event || !('request' in event)) return {}

  const url = new URL(event.request.url)
  return {
    method: event.request.method,
    path: url.pathname,
    status: event.response?.status,
    colo: coloFromCf(event.request.cf),
  }
}

function coloFromCf(cf: unknown) {
  if (!cf || typeof cf !== 'object') return undefined
  const candidate = cf as { colo?: unknown }
  return typeof candidate.colo === 'string' ? candidate.colo : undefined
}
