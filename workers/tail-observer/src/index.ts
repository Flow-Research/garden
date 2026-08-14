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

type AgentDiagnostic = {
  channel: string
  type: string
  severity: 'info' | 'warn' | 'error'
  timestamp: number | null
  agent: string | null
  name: string | null
  requestId?: string
  stage?: string
  method?: string
  fiberId?: string
  fiberName?: string
  serverId?: string
  state?: string
  code?: number
  errorName?: string
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
  cpuTime?: number
  wallTime?: number
  truncated?: boolean
  appEvents: GardenStructuredLog[]
  agentEvents: AgentDiagnostic[]
  exceptions: Array<{ name: string; message: string }>
}

type Env = {
  ENVIRONMENT?: string
  POSTHOG_LOGS_HOST?: string
  POSTHOG_PROJECT_TOKEN?: string
}

const SCHEMA_VERSION = 1
const ERROR_LEVELS = new Set(['warn', 'error'])
const AGENT_CHANNELS = new Set([
  'agents:chat',
  'agents:fiber',
  'agents:lifecycle',
  'agents:mcp',
  'agents:message',
  'agents:rpc',
])
const MAX_AGENT_EVENTS = 25

export default {
  /**
   * Normalizes Cloudflare Worker trace events from all Garden producer Workers.
   * Compact summaries remain in Workers Logs and notable records also leave via
   * PostHog's OTLP logs endpoint. References consulted: Cloudflare Tail Workers,
   * Agents observability, Workers Trace Events, and PostHog Logs docs.
   */
  async tail(events: TraceItem[], env: Env) {
    const summaries: TailSummary[] = []
    for (const event of events) {
      const appEvents = extractGardenLogs(event)
      const agentEvents = extractAgentDiagnostics(event)
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
        agentEvents,
        exceptions,
        message: summaryMessage(event, appEvents, agentEvents, exceptions),
      }

      if (shouldLogSummary(summary)) {
        emitSummary(summary)
        summaries.push(summary)
      }
    }

    if (summaries.length > 0) await exportPostHogLogs(summaries, env)
  },
} satisfies ExportedHandler<Env>

function shouldLogSummary(summary: TailSummary) {
  if (summary.outcome !== 'ok') return true
  if (summary.exceptions.length > 0) return true
  if (summary.appEvents.some((event) => ERROR_LEVELS.has(event.level ?? ''))) {
    return true
  }
  return summary.agentEvents.some((event) => event.severity !== 'info')
}

/**
 * Emits observer summaries with a dashboard-readable top-level message. Before
 * this, Cloudflare's Tail Worker invocation rows rendered as repeated "tail"
 * entries, which hid the producer route/error signal unless every row was
 * expanded. Persisted observer rows carry the route, outcome, and first app
 * event/exception in the row text while producerService stays filterable as a
 * structured field. Reference: Workers
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
  agentEvents: AgentDiagnostic[],
  exceptions: Array<{ name: string; message: string }>,
) {
  const fields = fetchEventFields(event.event)
  const route =
    fields.method && fields.path
      ? `${fields.method} ${fields.path}`
      : triggerName(event.event)
  const firstAppEvent =
    appEvents.find((entry) => ERROR_LEVELS.has(entry.level ?? '')) ??
    appEvents[0]
  const firstAgentEvent =
    agentEvents.find((entry) => entry.severity !== 'info') ?? agentEvents[0]
  const firstException = exceptions[0]
  const signal = firstException
    ? `${firstException.name}: ${firstException.message}`
    : firstAppEvent
      ? [firstAppEvent.level, firstAppEvent.component, firstAppEvent.event]
          .filter(Boolean)
          .join(' ')
      : firstAgentEvent
        ? [firstAgentEvent.channel, firstAgentEvent.type, firstAgentEvent.stage]
            .filter(Boolean)
            .join(' ')
        : event.outcome

  return [route, signal].filter(Boolean).join(' | ')
}

/**
 * Keeps Cloudflare Agents' native diagnostics attached to the same producer
 * invocation as Garden logs. Before this observer discarded every `agents:*`
 * event, so a Think stream could terminalize as an error while the Worker row
 * looked successful. The projection retains lifecycle/correlation fields and
 * excludes arbitrary SDK payloads. Reference: Cloudflare Agents observability
 * and Tail Workers diagnostics-channel documentation.
 */
export function extractAgentDiagnostics(event: TraceItem): AgentDiagnostic[] {
  return event.diagnosticsChannelEvents
    .flatMap((entry) => {
      if (!AGENT_CHANNELS.has(entry.channel)) return []
      const diagnostic = normalizeAgentDiagnostic(entry.channel, entry.message)
      return diagnostic ? [diagnostic] : []
    })
    .slice(0, MAX_AGENT_EVENTS)
}

function normalizeAgentDiagnostic(
  channel: string,
  message: unknown,
): AgentDiagnostic | null {
  if (!message || typeof message !== 'object') return null
  const record = message as Record<string, unknown>
  if (typeof record.type !== 'string') return null
  const payload =
    record.payload && typeof record.payload === 'object'
      ? (record.payload as Record<string, unknown>)
      : {}
  const error =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>)
      : null
  const severity = agentDiagnosticSeverity(record.type, payload)

  return {
    channel,
    type: record.type,
    severity,
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : null,
    agent: typeof record.agent === 'string' ? bounded(record.agent) : null,
    name: typeof record.name === 'string' ? bounded(record.name) : null,
    ...stringField(payload, 'requestId'),
    ...stringField(payload, 'stage'),
    ...stringField(payload, 'method'),
    ...stringField(payload, 'fiberId'),
    ...stringField(payload, 'fiberName'),
    ...stringField(payload, 'serverId'),
    ...stringField(payload, 'state'),
    ...(typeof payload.code === 'number' ? { code: payload.code } : {}),
    ...(error && typeof error.name === 'string'
      ? { errorName: bounded(error.name) }
      : {}),
  }
}

function agentDiagnosticSeverity(
  type: string,
  payload: Record<string, unknown>,
): AgentDiagnostic['severity'] {
  if (
    type.endsWith(':failed') ||
    type.endsWith(':error') ||
    type.endsWith(':exhausted') ||
    type === 'chat:stream:stalled' ||
    payload.error !== undefined
  ) {
    return 'error'
  }
  if (
    type === 'disconnect' &&
    typeof payload.code === 'number' &&
    payload.code !== 1_000 &&
    payload.code !== 1_001
  ) {
    return 'warn'
  }
  return 'info'
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' ? { [key]: bounded(value) } : {}
}

function bounded(value: string) {
  return value.slice(0, 256)
}

/**
 * Sends notable Worker/Agent summaries to PostHog's standard OTLP/HTTP logs
 * endpoint. Cloudflare remains the trace store; PostHog receives searchable
 * operational logs grouped by producer service. A failed export is reported to
 * Workers Logs without failing the producer invocation. Reference: PostHog
 * OpenTelemetry logging installation and OTLP JSON encoding.
 */
async function exportPostHogLogs(summaries: TailSummary[], env: Env) {
  const token = env.POSTHOG_PROJECT_TOKEN?.trim()
  const host = env.POSTHOG_LOGS_HOST?.trim()
  if (!token || !host) return

  const endpoint = `${host.replace(/\/$/, '')}/i/v1/logs`
  const result = await Promise.allSettled([
    fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(toOtlpLogs(summaries, env.ENVIRONMENT)),
    }),
  ])
  const settled = result[0]
  if (settled.status === 'rejected') {
    console.error({
      source: 'garden-tail-observer',
      message: 'posthog OTLP log export failed',
      errorName:
        settled.reason instanceof Error
          ? settled.reason.name
          : 'UnknownExportError',
    })
    return
  }
  if (!settled.value.ok) {
    console.error({
      source: 'garden-tail-observer',
      message: 'posthog OTLP log export rejected',
      status: settled.value.status,
    })
  }
}

export function toOtlpLogs(summaries: TailSummary[], environment = 'unknown') {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            otlpAttribute('service.name', 'garden-tail-observer'),
            otlpAttribute('deployment.environment.name', environment),
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'garden.tail', version: '1' },
            logRecords: summaries.map((summary) => ({
              timeUnixNano: String(Date.parse(summary.timestamp) * 1_000_000),
              severityNumber: severityNumber(summary),
              severityText: severityText(summary),
              body: { stringValue: summary.message },
              attributes: [
                otlpAttribute(
                  'service.producer.name',
                  summary.producerService ?? 'unknown',
                ),
                otlpAttribute('worker.outcome', summary.outcome),
                otlpAttribute('worker.trigger', summary.trigger),
                otlpAttribute('worker.path', summary.path ?? ''),
                otlpAttribute('worker.method', summary.method ?? ''),
                otlpAttribute('worker.status', summary.status ?? 0),
                otlpAttribute(
                  'garden.app_event_count',
                  summary.appEvents.length,
                ),
                otlpAttribute(
                  'garden.agent_event_count',
                  summary.agentEvents.length,
                ),
                otlpAttribute(
                  'garden.agent_event_types',
                  summary.agentEvents.map((event) => event.type).join(','),
                ),
              ],
            })),
          },
        ],
      },
    ],
  }
}

function severityText(summary: TailSummary) {
  return summary.outcome !== 'ok' ||
    summary.exceptions.length > 0 ||
    summary.agentEvents.some((event) => event.severity === 'error') ||
    summary.appEvents.some((event) => event.level === 'error')
    ? 'ERROR'
    : 'WARN'
}

function severityNumber(summary: TailSummary) {
  return severityText(summary) === 'ERROR' ? 17 : 13
}

function otlpAttribute(key: string, value: string | number) {
  return {
    key,
    value:
      typeof value === 'number'
        ? { intValue: String(value) }
        : { stringValue: value },
  }
}

function extractGardenLogs(event: TraceItem): GardenStructuredLog[] {
  const fromConsole = event.logs.flatMap((log) =>
    extractGardenRecords(log.message),
  )
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
  return (
    candidate.source === 'garden' && typeof candidate.schemaVersion === 'number'
  )
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
